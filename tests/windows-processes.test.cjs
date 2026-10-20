const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createProcessService, eligibleTarget, executableKey, runScript} = require('../windows-processes');
test('process targets exclude URLs, UWP, relative paths and malformed input', async () => {
  for (const value of ['https://a.exe', 'apps-folder:A!App', 'ms-settings:', 'C:\\a.url', 'relative/a.exe', {}, 'C:\\bad\n.exe']) assert.equal(eligibleTarget(value), false);
  for (const value of ['C:\\中文\\App.lnk', 'D:/Tools/App.EXE', 'wt.exe']) assert.equal(eligibleTarget(value), true);
  assert.equal(executableKey('C:/Tools/App.EXE'), 'c:\\tools\\app.exe');
  const service = createProcessService({supported:false, query:() => assert.fail('unsupported query')});
  assert.deepEqual(await service.get(['wt.exe']), {targets:[], supported:false});
});
test('running paths match shortcuts; caches expire and launch invalidates process snapshot', async () => {
  let time = 0, reads = 0, resolutions = 0, running = [];
  const source = 'C:\\桌面\\App.lnk';
  const service = createProcessService({supported:true, now:() => time,
    query:async () => { reads++; return running; },
    resolve:async targets => { resolutions++; return targets.map(source => ({source, target:'C:\\Tools\\App.exe'})); }});
  assert.deepEqual((await service.get([source])).targets, []);
  running = [{ExecutablePath:'c:/tools/APP.exe'}];
  assert.deepEqual((await service.get([source])).targets, []);
  service.invalidate(); assert.deepEqual((await service.get([source])).targets, [source]);
  assert.equal(reads, 2); assert.equal(resolutions, 1);
  time = 310000; assert.deepEqual((await service.get([source])).targets, [source]);
  assert.equal(reads, 3); assert.equal(resolutions, 2);
  service.clear(); await service.get([source]); assert.equal(resolutions, 3);
});
test('batches are serialized and bounded; malformed process responses recover', async () => {
  let active = 0, maximum = 0, reads = 0; const batches = [];
  const service = createProcessService({supported:true, query:async () => { reads++; return ['C:\\App.exe']; },
    resolve:async targets => { active++; maximum = Math.max(active, maximum); batches.push(targets.length);
      await new Promise(resolve => setImmediate(resolve)); active--;
      return targets.map(source => ({source, target:'C:\\App.exe'})); }});
  const targets = Array.from({length:700}, (_, i) => 'C:\\' + i + '.lnk');
  const results = await Promise.all([service.get(targets), service.get(targets.slice(0,2))]);
  assert.equal(results[0].targets.length, 500); assert.equal(results[1].targets.length, 2);
  assert.equal(maximum, 1); assert.equal(reads, 1); assert.ok(batches.every(n => n <= 64));
  let fail = true;
  const broken = createProcessService({supported:true, query:async () => fail ? {} : [], resolve:async () => []});
  assert.ok((await broken.get(['wt.exe'])).error); fail = false;
  assert.equal((await broken.get(['wt.exe'])).error, undefined);
});
test('invalidation during a query prevents caching an outdated snapshot', async () => {
  let finish, reads = 0;
  const service = createProcessService({supported:true, query:async () => { reads++; if (reads === 1) await new Promise(resolve => {finish = resolve;}); return []; }, resolve:async () => []});
  const task = service.get(['wt.exe']); await new Promise(resolve => setImmediate(resolve));
  service.invalidate(); finish(); await task; await service.get(['wt.exe']); assert.equal(reads, 2);
});
test('PowerShell path is absolute with encoded command, JSON stdin and timeout', async () => {
  let invocation, input;
  const result = await runScript('resolve-targets.ps1', ['C:\\中文 & x.lnk'], (exe,args,options,callback) => {
    invocation = {exe,args,options}; queueMicrotask(() => callback(null, '\uFEFF[]'));
    return {stdin:{on(){},end(value){input=value;}}}; });
  assert.deepEqual(result, []); assert.match(invocation.exe, /^[a-z]:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.ok(invocation.args.includes('-EncodedCommand')); assert.equal(invocation.options.timeout, 8000);
  assert.deepEqual(JSON.parse(input), ['C:\\中文 & x.lnk']);
});

test('delayed launch refresh bypasses an early snapshot with a one-second burst limit', async () => {
  let time = 0, reads = 0, running = [];
  const service = createProcessService({ supported: true, now: () => time,
    query: async () => { reads++; return running; },
    resolve: async targets => targets.map(source => ({ source, target: 'C:/Tools/App.exe' })) });
  await service.get(['C:/Desktop/App.lnk']);
  running = ['C:/Tools/App.exe']; time = 1500;
  assert.deepEqual((await service.get(['C:/Desktop/App.lnk'], true)).targets, ['C:/Desktop/App.lnk']);
  assert.equal(reads, 2);
  await Promise.all(Array.from({ length: 10 }, () => service.get(['C:/Desktop/App.lnk'], true)));
  assert.equal(reads, 2);
});
