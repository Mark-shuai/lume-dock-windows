const { app, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const assert = require('node:assert/strict');
const { createWindowsIconLoader } = require('../windows-icons');
const { createAppIconReader } = require('../app-icon-reader');
const { createAppCatalog } = require('../windows-apps');
const { createIdentityResolver } = require('../app-identities');
async function powershell(source, data) {
  return new Promise((resolve, reject) => {
    const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = execFile(executable, ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide:true, timeout:15000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(data));
  });
}
app.whenReady().then(async () => {
  if (process.platform !== 'win32') { console.log('SKIPPED: Windows native icon check requires Windows.'); app.exit(0); return; }
  let directory;
  const appIcons = createAppIconReader();
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'Lume 中文 & icons-'));
    // A classic 24-bit icon relies on its AND mask, not RGB color-key removal.
    const ico = Buffer.alloc(22 + 40 + 16 * 48 + 16 * 4);
    ico.writeUInt16LE(1,2); ico.writeUInt16LE(1,4);
    ico[6]=16; ico[7]=16; ico.writeUInt16LE(1,10); ico.writeUInt16LE(24,12);
    ico.writeUInt32LE(ico.length-22,14); ico.writeUInt32LE(22,18);
    ico.writeUInt32LE(40,22); ico.writeInt32LE(16,26); ico.writeInt32LE(32,30);
    ico.writeUInt16LE(1,34); ico.writeUInt16LE(24,36);
    for(let y=0;y<16;y++) for(let x=0;x<16;x++) {
      if(x<4 || x>=12 || y<4 || y>=12) ico[22+40+768+y*4+(x>>3)] |= 0x80>>(x%8);
    }
    await fs.writeFile(path.join(directory,'legacy.ico'),ico);
    const fixtureScript = [
      "$ErrorActionPreference='Stop'",
      '[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)',
      '$directory=ConvertFrom-Json ([Console]::In.ReadToEnd())',
      '$shell=New-Object -ComObject WScript.Shell',
      'try {',
      '  foreach($name in @("target.lnk", "custom.lnk", "profile.lnk", "legacy.lnk")) {',
      '    $link=$shell.CreateShortcut([IO.Path]::Combine($directory,$name))',
      '    try {',
      '      $link.TargetPath=[IO.Path]::Combine($env:SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe")',
      '      if($name -eq "custom.lnk") { $link.IconLocation=[IO.Path]::Combine($env:SystemRoot,"System32","shell32.dll")+",3" }',
      '      if($name -eq "profile.lnk") { $link.Arguments="-NoProfile" }',
      '      if($name -eq "legacy.lnk") { $link.IconLocation=[IO.Path]::Combine($directory,"legacy.ico")+",0" }',
      '      $link.Save()',
      '    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) }',
      '  }',
      '} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }',
      '$url="[InternetShortcut]"+"\r\nURL=https://example.com\r\nIconFile="+[IO.Path]::Combine($env:SystemRoot,"System32","shell32.dll")+"\r\nIconIndex=3\r\n"',
      '[IO.File]::WriteAllText([IO.Path]::Combine($directory,"site.url"),$url,[Text.Encoding]::Unicode)',
    ].join('\n').replaceAll('\\r\\n', '\r\n');
    await powershell(fixtureScript, directory);
    const alphaPath = path.join(__dirname, 'icon-alpha.test.ps1').replaceAll("'", "''");
    const alphaResult = await powershell(`& '${alphaPath}' -Native`, null);
    const alphaPng = alphaResult.trim().split(/\r?\n/).find(line=>line.startsWith('data:image/png;base64,'));
    assert.ok(alphaPng, 'Native HBITMAP conversion returns PNG');
    const alphaImage = nativeImage.createFromDataURL(alphaPng);
    assert.deepEqual(alphaImage.getSize(), {width:4,height:1});
    assert.deepEqual([...alphaImage.toBitmap()].filter((_v,i)=>i%4===3), [0,255,128,255], 'Transparent, opaque and half-alpha pixels survive native GDI + PNG');
    assert.deepEqual([...alphaImage.toBitmap()].slice(4,8), [0,0,0,255], 'Real black icon artwork stays opaque');
    const reads = [];
    const load = createWindowsIconLoader({readIcon: async file => { reads.push(file); const icon = await app.getFileIcon(file,{size:'large'}); return icon.isEmpty() ? null : icon.toDataURL(); }});
    const names=['target.lnk','custom.lnk','site.url'];
    const icons=await Promise.all(names.map(name => load(path.join(directory,name))));
    assert.ok(icons.every(icon => /^data:image\/png;base64,/.test(icon || '')), 'Every fixture must resolve an icon');
    assert.ok(reads.some(file => file.toLowerCase().endsWith('powershell.exe')), 'Plain shortcut must resolve to its target');
    assert.ok(!reads.some(file => /\.(lnk|url)$/i.test(file)), 'Fixtures must resolve without generic shortcut fallback');
    assert.ok(!reads.some(file => file.toLowerCase().endsWith('shell32.dll')), 'Nonzero resource index must be extracted by PowerShell');
    const legacy = nativeImage.createFromDataURL(await load(path.join(directory,'legacy.lnk')));
    const legacyPixels = legacy.toBitmap(), legacySize = legacy.getSize();
    assert.equal(legacyPixels[3],0,'24-bit legacy AND mask preserves transparent corners');
    const center = (Math.floor(legacySize.height/2)*legacySize.width+Math.floor(legacySize.width/2))*4;
    assert.deepEqual([...legacyPixels].slice(center,center+4),[0,0,0,255],'Legacy black artwork is not erased');
    const identities = await createIdentityResolver().get(['target.lnk','custom.lnk','profile.lnk'].map(name=>path.join(directory,name)));
    assert.equal(identities.length,3);
    assert.equal(identities[0].identity[0],identities[1].identity[0],'Same executable shortcuts share program identity');
    assert.notEqual(identities[0].identity[0],identities[2].identity[0],'Different launch arguments remain distinct');
    const catalog = await createAppCatalog().list();
    assert.ok(!catalog.error, catalog.error);
    assert.ok(catalog.items.every(item => !Object.hasOwn(item, 'icon')), 'discovery only returns metadata');
    const registered = catalog.items.filter(item => item.target.startsWith('apps-folder:')).slice(0, 8);
    assert.ok(registered.length, 'Windows registered applications are available for native icon checks');
    const nativeArtwork = await Promise.all(registered.map(item => appIcons.get(item.target)));
    assert.ok(nativeArtwork.some(icon => /^data:image\/png;base64,/.test(icon || '')), 'on-demand AppsFolder reader returns real native artwork');
    assert.equal(await appIcons.get('apps-folder:Lume.Nonexistent.NativeFixture.000000'), null, 'missing app falls back without failing the batch');
    for (const icon of nativeArtwork.filter(Boolean)) assert.ok(!nativeImage.createFromDataURL(icon).isEmpty());
    appIcons.dispose();
    console.log('Windows native AppsFolder icons passed: metadata-only discovery, lazy batch artwork and missing-app fallback.');
    console.log('Windows native icons passed: Chinese/space/& path, real shortcut target, nonzero DLL resource, UTF-16 URL shortcut, three-path batch, native HBITMAP alpha/PNG and legacy ICO AND mask.');
    console.log('Windows native identities passed: real shortcut resolution, equivalent aliases and distinct arguments.');
    await fs.rm(directory,{recursive:true,force:true});
    app.exit(0);
  } catch(error) {
    appIcons.dispose();
    console.error(error);
    if(directory) await fs.rm(directory,{recursive:true,force:true}).catch(() => {});
    app.exit(1);
  }
});
