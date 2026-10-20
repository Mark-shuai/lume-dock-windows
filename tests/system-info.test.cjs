const test = require('node:test');
const assert = require('node:assert/strict');
const { getBattery, parseBatteryOutput } = require('../system-info');

test('battery parser accepts Windows CIM JSON and detects charging states', () => {
  assert.deepEqual(parseBatteryOutput('{"EstimatedChargeRemaining":87,"BatteryStatus":2}'), { level: 87, charging: true });
  assert.deepEqual(parseBatteryOutput('[{"EstimatedChargeRemaining":41,"BatteryStatus":1}]'), { level: 41, charging: false });
  assert.equal(parseBatteryOutput('{"EstimatedChargeRemaining":140}'), null);
  assert.equal(parseBatteryOutput(''), null);
});

test('battery discovery is Windows-only and does not invoke PowerShell elsewhere', async () => {
  let calls = 0;
  assert.equal(await getBattery({ platform: 'darwin', execFileImpl: () => { calls++; } }), null);
  assert.equal(calls, 0);
});

test('battery discovery handles PowerShell output and failures', async () => {
  const exec = (_file, _args, _options, callback) => callback(null, '{"EstimatedChargeRemaining":63,"BatteryStatus":1}', '');
  assert.deepEqual(await getBattery({ platform: 'win32', execFileImpl: exec }), { level: 63, charging: false });
  const failed = (_file, _args, _options, callback) => callback(new Error('missing'), '', '');
  assert.equal(await getBattery({ platform: 'win32', execFileImpl: failed }), null);
});
