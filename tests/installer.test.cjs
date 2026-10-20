const { test } = require('node:test');
const assert = require('node:assert/strict');
const { patchedInstaller, replaceOnce } = require('../scripts/prepare-nsis.cjs');
const fs = require('node:fs');
const path = require('node:path');

test('legacy upgrade runs through the same-volume wrapper and preserves upstream registration handling', () => {
  const script = patchedInstaller();
  assert.ok(script.includes('lume-upgrade-uninstall.ps1'));
  assert.ok(script.includes('-Uninstaller "$uninstallerFileName" -InstallDirectory "$installationDir" -UninstallArguments "$0"'));
  assert.ok(!script.includes('ExecWait \'"$uninstallerFileNameTemp"'));
  assert.ok(!script.includes('TryInPlace:'));
  assert.ok(script.includes('Call handleUninstallResult'));
  assert.ok(script.includes('Call uninstallOldVersion'));
  assert.ok(script.includes('SetErrorLevel 2\n      Quit'), 'do not install over failed uninstall');
  assert.ok(script.includes('InstallerLogs'));
});
test('build patch refuses ambiguous or changed upstream templates', () => {
  assert.throws(() => replaceOnce('other', 'expected', 'patch'), /template changed/);
  assert.throws(() => replaceOnce('expected expected', 'expected', 'patch'), /template changed/);
});
test('installer shutdown targets the installation path and missing-uninstaller repair does not erase registration/data', () => {
  const include = fs.readFileSync(path.join(__dirname,'../scripts/installer.nsh'),'utf8');
  const helper = fs.readFileSync(path.join(__dirname,'../scripts/stop-installed-app.ps1'),'utf8');
  const upgrade = fs.readFileSync(path.join(__dirname,'../scripts/upgrade-uninstall.ps1'),'utf8');
  assert.match(include,/customCheckAppRunning/);assert.match(include,/-InstallDirectory "\$INSTDIR"/);
  assert.equal(helper.includes('taskkill'),false);
  assert.match(helper,/CreationDate -eq \$old.CreationDate/);
  assert.match(helper,/helperPaths -contains \$item.ExecutablePath/);
  assert.match(upgrade,/Old uninstaller missing: continuing as repair install/);
  assert.equal(upgrade.includes('Remove-ItemProperty'),false);assert.equal(upgrade.includes('Remove-Item -LiteralPath $directoryPath'),false);
});
