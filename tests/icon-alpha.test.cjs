const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const executable = process.env.LUME_TEST_POWERSHELL || (process.platform === 'win32'
  ? path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : '');
test('production C# compiles and retains alpha, black content and edge colors', { skip: !executable }, () => {
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'icon-alpha.test.ps1')], { encoding:'utf8', windowsHide:true, timeout:30000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /alpha conversion passed/);
});
