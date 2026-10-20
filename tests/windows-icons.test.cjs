const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWindowsIconLoader } = require('../windows-icons');
const { createIconService } = require('../icon-service');
const png = 'data:image/png;base64,AAAA';
test('shortcut icons batch concurrent paths and use custom resources or real targets', async () => {
  const batches = [], reads = [];
  const load = createWindowsIconLoader({
    resolve: async targets => {
      batches.push(targets);
      return [{ source: targets[1], candidates: ['C:\\Apps\\Real.exe'] }, { source: targets[0], icon: png }];
    },
    readIcon: async target => { reads.push(target); return png; },
  });
  const service = createIconService({ load });
  const paths = ['C:\\桌面\\Custom.lnk', 'C:\\桌面\\App & Name.lnk'];
  assert.deepEqual(await Promise.all(paths.map(target => service.get(target))), [png, png]);
  assert.deepEqual(batches, [paths]);
  assert.deepEqual(reads, ['C:\\Apps\\Real.exe']);
  assert.equal(await service.get(paths[0]), png);
  assert.equal(batches.length, 1);
});
test('resolver failure and missing custom icons fall back and the queue recovers', async () => {
  let batches = 0;
  const reads = [];
  const load = createWindowsIconLoader({ resolve: async targets => {
    if (++batches === 1) throw new Error('PowerShell denied');
    return targets.map(source => ({ source, candidates: ['javascript:bad', 'C:\\missing.ico', 'C:\\good.exe'] }));
  }, readIcon: async target => {
    reads.push(target);
    if (target.endsWith('missing.ico')) throw new Error('Missing');
    return png;
  } });
  assert.equal(await load('C:\\a.lnk'), png);
  assert.equal(await load('C:\\b.url'), png);
  assert.deepEqual(reads, ['C:\\a.lnk', 'C:\\missing.ico', 'C:\\good.exe']);
});
test('requests during a batch use only one active resolver', async () => {
  let active = 0, peak = 0;
  const load = createWindowsIconLoader({ resolve: async targets => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return targets.map(source => ({ source, icon: png }));
  }, readIcon: async () => null });
  const first = load('C:\\first.lnk');
  await new Promise(resolve => setImmediate(resolve));
  const rest = Array.from({ length: 75 }, (_, i) => load('C:\\' + i + '.lnk'));
  assert.deepEqual(await Promise.all([first, ...rest]), Array(76).fill(png));
  assert.equal(peak, 1);
});
