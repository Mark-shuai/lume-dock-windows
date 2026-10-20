const { spawnSync } = require('node:child_process');
const path = require('node:path');
const executable = process.env.LUME_TEST_POWERSHELL || (process.platform === 'win32'
  ? path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : '');
if (!executable) {
  console.log('SKIP: upgrade fixtures need Windows PowerShell, or LUME_TEST_POWERSHELL for portable logic checks');
} else {
  for (const script of ['upgrade-uninstall.test.ps1','stop-installed-app.test.ps1']) {
    const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, script)], { stdio:'inherit', windowsHide:true, timeout:60000 });
    if (result.error) console.error(result.error);
    if (result.status !== 0 || result.error) process.exit(1);
  }
}
