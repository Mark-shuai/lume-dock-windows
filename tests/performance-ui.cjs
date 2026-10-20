const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const baseline = process.env.LUME_PERF_BASELINE === '1';
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lume-performance-')));
require('../main');
const catalog = Array.from({ length: 1000 }, (_, i) => ({ id: `perf-${i}`, name: `App ${i}`, target: `C:/Tools/${i}.exe` }));
for (const name of ['list-apps', 'scan-desktop', 'get-icon']) ipcMain.removeHandler(name);
ipcMain.handle('list-apps', () => ({ items: catalog, warnings: [] }));
ipcMain.handle('scan-desktop', () => ({ items: [] }));
const png = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, '../renderer/assets/macos/generic.png')).toString('base64')}`;
let holdIcons = false;
const pendingIcons = [];
ipcMain.handle('get-icon', (_event, target) => holdIcons && target.endsWith('/999.exe') ?
  new Promise(resolve => pendingIcons.push(resolve)) : null);
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const js = source => win.webContents.executeJavaScript(source);
  try {
    if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await js('window.dockReady');
    const result = await js(`(async () => {
      let merges = 0, librarySerializations = 0;
      const merge = appIdentity.mergeEntries, stringify = JSON.stringify;
      appIdentity.mergeEntries = (...args) => { merges++; return merge(...args); };
      JSON.stringify = function(value, ...args) { if (value === libraryItems) librarySerializations++; return stringify(value, ...args); };
      try {
        await launcher.open();
        const initialMerges = merges;
        const search = document.querySelector('#appSearch');
        const start = performance.now();
        for (let i = 0; i < 80; i++) {
          search.value = ['App 1', 'App 99', 'absent', ''][i % 4];
          search.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const searchMs = performance.now() - start;
        const searchMerges = merges - initialMerges;
        search.value = 'App 999'; search.dispatchEvent(new Event('input'));
        const pin = document.querySelector('.app-pin'); pin.click();
        const pinned = document.querySelector('.app-pin').getAttribute('aria-pressed') === 'true';
        document.querySelector('.app-pin').click();
        const unpinned = document.querySelector('.app-pin').getAttribute('aria-pressed') === 'false';
        launcher.close();
        const before = librarySerializations;
        for (let i = 0; i < 20; i++) {
          themeSelect.value = i % 2 ? 'dark' : 'light';
          themeSelect.dispatchEvent(new Event('change'));
        }
        return { searchMs, searchMerges, preferenceLibrarySerializations: librarySerializations - before,
          mountedAfterClose: document.querySelectorAll('.app-cell').length, pinned, unpinned };
      } finally { appIdentity.mergeEntries = merge; JSON.stringify = stringify; }
    })()`);
    assert.equal(result.mountedAfterClose, 0);
    assert.ok(result.pinned && result.unpinned, 'cache invalidates after pin and unpin');
    if (!baseline) {
      assert.equal(result.searchMerges, 0, 'typing reuses the application index');
      assert.equal(result.preferenceLibrarySerializations, 0, 'preferences do not serialize the library');
      // Close while an icon is in flight, then reopen before it resolves.
      holdIcons = true;
      await js(`(async () => { await launcher.open(); appSearch.value = 'App 999'; appSearch.dispatchEvent(new Event('input')); })()`);
      for (let i = 0; i < 80 && !pendingIcons.length; i++) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(pendingIcons.length, 'icon request started before closing');
      await js(`(async () => { launcher.close(); await launcher.open(); appSearch.value = 'App 999'; appSearch.dispatchEvent(new Event('input')); })()`);
      let loaded = false;
      for (let i = 0; i < 80 && !loaded; i++) {
        pendingIcons.splice(0).forEach(resolve => resolve(png));
        await new Promise(resolve => setTimeout(resolve, 25));
        loaded = await js(`document.querySelector('.app-art')?.classList.contains('has-icon')`);
      }
      assert.ok(loaded, `reopened panel receives its icon despite an older in-flight request: ${JSON.stringify({pending:pendingIcons.length, dom:await js(`({hidden:launcher.isOpen(), names:[...document.querySelectorAll('.app-name')].map(node=>node.textContent), art:document.querySelector('.app-art')?.outerHTML})`)})}`);
      holdIcons = false;
      await js('launcher.close()');
    }
    const report = { date: new Date().toISOString(), version: require('../package.json').version, platform: process.platform, arch: process.arch,
      apps: 1000, searches: 80, ...result, limitations: 'Synthetic macOS/Electron workload; elapsed time is host-dependent, not a Windows working-set measurement.' };
    fs.writeFileSync(path.join(__dirname, '../docs', baseline ? 'performance-before-0.12.12.json' : 'performance-after-0.12.12.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
