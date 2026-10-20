const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIconService } = require('../icon-service');
const icon = 'data:image/png;base64,AAAA';

test('native icons share in-flight requests, respect concurrency and recover from errors', async () => {
  let active = 0, peak = 0, calls = 0;
  const service = createIconService({ load: async target => {
    calls++;
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if (target.endsWith('bad.exe')) throw new Error('Missing icon');
    return icon;
  } });
  const first = service.get('C:\\Tools\\App.exe');
  assert.equal(service.get('c:/tools/app.exe'), first);
  const values = await Promise.all([first, ...Array.from({ length: 40 }, (_, i) => service.get(`C:\\${i}.exe`)), service.get('C:\\bad.exe')]);
  assert.equal(values.at(-1), null);
  assert.equal(peak, 4);
  assert.equal(calls, 42);
  await service.get('C:\\Tools\\App.exe');
  assert.equal(calls, 42);
  assert.equal(await service.get({}), null);
});

test('entry count, byte budget and expiry evict native icons instead of growing forever', async () => {
  let calls = 0, time = 0;
  const service = createIconService({ maxEntries: 2, maxBytes: icon.length * 4, ttl: 10, now: () => time, load: async () => { calls++; return icon; } });
  await service.get('a'); await service.get('b'); await service.get('a');
  await service.get('c');
  assert.equal(calls, 3);
  await service.get('b');
  assert.equal(calls, 4);
  time = 11;
  await service.get('b');
  assert.equal(calls, 5);
  const small = createIconService({ maxBytes: icon.length * 2, load: async () => { calls++; return icon; } });
  await small.get('a'); await small.get('b'); await small.get('a');
  assert.equal(calls, 8);
});

test('oversized or invalid icons cannot fill the cache and failures use a bounded negative cache', async () => {
  let calls = 0;
  const service = createIconService({ load: async () => { calls++; return 'data:image/png;base64,' + 'A'.repeat(150_000); } });
  assert.equal(await service.get('a'), null);
  assert.equal(await service.get('a'), null);
  assert.equal(calls, 1);
});
