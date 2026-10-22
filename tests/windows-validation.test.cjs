const { test } = require('node:test');
const assert = require('node:assert/strict');
const { optionsFor } = require('../scripts/verify-windows.cjs');
test('Windows validation has bounded duration, cycles and explicit synthetic mode', () => {
  assert.deepEqual(optionsFor([]), { minutes: 60, cycles: 100, intervalSeconds: 30, smoke: false });
  assert.equal(optionsFor(['--quick']).minutes, 0);
  assert.equal(optionsFor(['--minutes', '120', '--cycles', '200', '--interval', '60']).cycles, 200);
  assert.equal(optionsFor(['--smoke']).cycles, 8);
  for (const args of [['--minutes'], ['--minutes', 'NaN'], ['--minutes', '-1'], ['--minutes', '9999'], ['--cycles', '0'], ['--cycles', '2.5'], ['--interval', '0'], ['--unknown']]) assert.throws(() => optionsFor(args));
});
