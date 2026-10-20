const { build, Platform, Arch } = require('electron-builder');
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget');
const { patchedInstaller } = require('./prepare-nsis.cjs');

// Apply a guarded build-process-only template transform. Keep the normal two-pass
// uninstaller generation: nsis.script would disable that pipeline in this builder.
const compileScript = NsisTarget.prototype.computeFinalScript;
if (typeof compileScript !== 'function') throw new Error('NSIS builder API changed; review the upgrade patch');
NsisTarget.prototype.computeFinalScript = function (script, installer, archs) {
  return compileScript.call(this, installer && !this.isPortable ? patchedInstaller(script) : script, installer, archs);
};
build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64) }).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
