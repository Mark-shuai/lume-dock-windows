const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppIconReader } = require('../app-icon-reader');
const png = 'data:image/png;base64,AAAA';
const frame = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  const children = [], timers = new Set();
  const reader = createAppIconReader({ supported: true, readScript: () => 'native reader source',
    later: (fn, ms) => { const timer = { fn, ms }; timers.add(timer); return timer; },
    cancel: timer => timers.delete(timer),
    spawnProcess: (exe, args, settings) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
      child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.batches = []; child.stdin.write = text => child.batches.push(JSON.parse(text));
      child.kill = () => { child.killed = true; };
      child.reply = records => child.stdout.emit('data', JSON.stringify(records) + '\n');
      children.push(child);
      assert.match(exe, /WindowsPowerShell[\\/]v1.0[\\/]powershell.exe$/);
      assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), 'native reader source');
      assert.equal(settings.windowsHide, true);
      return child;
    }, ...options });
  return { reader, children, timers };
}

test('app artwork reader starts only on demand, batches JSON and reuses one helper until idle', async () => {
  const { reader, children, timers } = fixture();
  assert.equal(children.length, 0);
  const targets = ['apps-folder:Vendor.中文 & App!Main', 'apps-folder:Other.App'];
  const requests = targets.map(target => reader.get(target)); await frame();
  const child = children[0];
  assert.deepEqual(child.batches, [targets]);
  const third = reader.get('apps-folder:Third.App'); await frame();
  assert.equal(child.batches.length, 1, 'requests serialize while a batch is in flight');
  const response = JSON.stringify(targets.map(source => ({ source, icon: png }))) + '\n';
  child.stdout.emit('data', response.slice(0, 20)); child.stdout.emit('data', response.slice(20));
  assert.deepEqual(await Promise.all(requests), [png, png]); await frame();
  assert.equal(children.length, 1, 'bursts do not launch a PowerShell per icon');
  child.reply([{ source: 'apps-folder:Third.App', icon: null }]); assert.equal(await third, null);
  const idle = [...timers].find(timer => timer.ms === 2000);
  assert.ok(idle); idle.fn(); assert.equal(child.killed, true);
  const next = reader.get('apps-folder:New.App'); await frame();
  child.emit('exit', 0); // Late exit of an old helper cannot kill its replacement.
  assert.equal(children.length, 2);
  children[1].reply([{ source: 'apps-folder:New.App', icon: png }]);
  assert.equal(await next, png); reader.dispose();
  assert.equal(timers.size, 0);
});

test('app artwork errors, timeout, malformed output and bounded output recover on the next request', async () => {
  for (const failure of ['error', 'exit', 'stdin', 'json', 'shape', 'overflow', 'timeout']) {
    const { reader, children, timers } = fixture();
    const first = reader.get('apps-folder:Fail.App'); await frame();
    const queued = reader.get('apps-folder:Queued.App'); const child = children[0];
    if (failure === 'error') child.emit('error', new Error('denied'));
    if (failure === 'exit') child.emit('exit', 1);
    if (failure === 'stdin') child.stdin.emit('error', new Error('closed'));
    if (failure === 'json') child.stdout.emit('data', 'malformed\n');
    if (failure === 'shape') child.reply({ icon: png });
    if (failure === 'overflow') child.stdout.emit('data', 'x'.repeat(8 * 1024 * 1024 + 1));
    if (failure === 'timeout') [...timers].find(timer => timer.ms === 15000).fn();
    assert.equal(await first, null, failure); assert.equal(await queued, null, failure);
    assert.equal(child.killed, true);
    const next = reader.get('apps-folder:Good.App'); await frame();
    children.at(-1).reply([{ source: 'apps-folder:Good.App', icon: png }]);
    assert.equal(await next, png); reader.dispose();
  }
});

test('app artwork validates results, caps pending work and disposes without hanging promises', async () => {
  const { reader, children, timers } = fixture();
  for (const bad of [null, {}, '', 'apps-folder:', 'C:/file.exe', 'apps-folder:bad\nvalue', 'apps-folder:' + 'x'.repeat(4096)]) assert.equal(await reader.get(bad), null);
  assert.equal(children.length, 0);
  const requests = Array.from({ length: 256 }, (_, i) => reader.get('apps-folder:App.' + i));
  assert.equal(await reader.get('apps-folder:Overflow'), null); await frame();
  const child = children[0]; assert.equal(child.batches[0].length, 64);
  child.reply(child.batches[0].map((source, i) => ({ source, icon: i === 0 ? png : i === 1 ? 'javascript:bad' : 'data:image/png;base64,' + 'A'.repeat(128 * 1024) })));
  assert.equal(await requests[0], png); assert.equal(await requests[1], null); assert.equal(await requests[2], null);
  reader.dispose();
  const results = await Promise.all(requests);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(child.killed, true); assert.equal(timers.size, 0);
  assert.equal(await reader.get('apps-folder:After.Dispose'), null);
});

test('unsupported host and synchronous startup failure return fallback without retaining work', async () => {
  const unsupported = fixture({ supported: false });
  assert.equal(await unsupported.reader.get('apps-folder:App'), null); assert.equal(unsupported.children.length, 0);
  const { reader } = fixture({ readScript: () => { throw new Error('missing script'); } });
  const request = reader.get('apps-folder:App'); await frame(); assert.equal(await request, null); reader.dispose();
});
