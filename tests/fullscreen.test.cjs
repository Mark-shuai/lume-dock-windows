const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createFullscreenMonitor, createFullscreenPolicy} = require('../fullscreen-monitor');
function fixture(options = {}) {
  let time = 0; const timers = new Set(), deadlines = new Set(), children = [], states = [], launches = [];
  const monitor = createFullscreenMonitor({supported:true, now:() => time, onState:value => states.push(value),
    setTimer:fn => {timers.add(fn);return fn;}, clearTimer:fn => timers.delete(fn),
    later:fn => {deadlines.add(fn);return fn;}, cancelLater:fn => deadlines.delete(fn),
    ...options, spawnProcess:(exe,args,options) => {
      launches.push({exe,args,options}); const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
      child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.writes = [];
      child.stdin.write = value => child.writes.push(value); child.kill = () => {child.killed = true;child.emit('exit',0);};
      children.push(child);return child; }});
  return {monitor,timers,deadlines,children,states,launches,
    tick:(value=time) => {time=value;[...timers].forEach(fn => fn());},
    answer:(value, own=false) => children.at(-1).stdout.emit('data', JSON.stringify({fullscreen:value,own})+'\r\n')};
}
test('fullscreen exemption lasts until the fullscreen session ends', () => {
  const policy = createFullscreenPolicy(); policy.reveal(); policy.update(true); assert.equal(policy.shouldHide,true);
  policy.reveal(); assert.equal(policy.shouldHide,false); policy.update(true); assert.equal(policy.shouldHide,false);
  policy.update(false); policy.update(true); assert.equal(policy.shouldHide,true);
});
test('one helper handles partial lines, ignores own window and stops completely when disabled', () => {
  const f = fixture(); f.monitor.setEnabled(true); f.monitor.setEnabled(true);
  assert.equal(f.children.length,1); assert.equal(f.timers.size,1); assert.equal(f.deadlines.size,1);
  assert.match(f.launches[0].exe, /^[a-z]:\\Windows\\System32/i); assert.equal(f.children[0].writes[0], 'probe\n');
  f.children[0].stdout.emit('data','{"fullscreen":tr'); f.children[0].stdout.emit('data','ue,"own":false}\n');
  assert.deepEqual(f.states,[true]); assert.equal(f.deadlines.size,0);
  f.tick(); f.answer(false,true); assert.deepEqual(f.states,[true]);
  f.tick(); f.answer(false); assert.deepEqual(f.states,[true,false]); assert.equal(f.children.length,1);
  f.monitor.setEnabled(false); assert.equal(f.children[0].killed,true); assert.equal(f.timers.size,0); assert.equal(f.deadlines.size,0); f.monitor.dispose();
});
test('probe errors preserve fullscreen state, back off and ignore late helper output', () => {
  const f = fixture(); f.monitor.setEnabled(true); f.answer(true); f.tick();
  f.children[0].stdout.emit('data','invalid\n'); assert.equal(f.children[0].killed,true); assert.deepEqual(f.states,[true]);
  f.tick(1000); assert.equal(f.children.length,1); f.tick(2000); assert.equal(f.children.length,2);
  f.children[0].stdout.emit('data','{"fullscreen":false,"own":false}\n'); assert.deepEqual(f.states,[true]);
  f.answer(false); assert.deepEqual(f.states,[true,false]);
  f.tick(); [...f.deadlines].forEach(fn => fn()); assert.equal(f.children[1].killed,true);
  f.monitor.dispose(); assert.equal(f.timers.size,0); assert.equal(f.deadlines.size,0);
});
test('unsupported platform never starts a helper or timer', () => {
  const monitor = createFullscreenMonitor({supported:false,spawnProcess:() => assert.fail('spawn'),setTimer:() => assert.fail('timer')}); monitor.setEnabled(true); monitor.dispose();
});

test('packaged helper uses encoded script text, keeps stdin free and caches the source', () => {
  let reads = 0;
  const source = 'param([int]$DockPid)\n# fixture in 中文/app.asar\n[Console]::ReadLine()';
  const f = fixture({ownPid:12345,readScript:() => {reads++;return source;}});
  f.monitor.setEnabled(true);
  const args = f.launches[0].args;
  assert.equal(args.includes('-File'),false);
  const command = Buffer.from(args[args.indexOf('-EncodedCommand')+1], 'base64').toString('utf16le');
  assert.equal(command,'& {\n'+source+'\n} -DockPid 12345');
  assert.deepEqual(f.launches[0].options.stdio,['pipe','pipe','pipe']);
  assert.deepEqual(f.children[0].writes,['probe\n']);
  f.children[0].emit('error',new Error('injected'));
  f.tick(30000);
  assert.equal(f.children.length,2);
  assert.equal(reads,1);
  f.monitor.dispose();
});
