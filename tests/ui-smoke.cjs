const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-smoke-'));
app.setPath('userData', temp);
require('../main');
let scanFails = false;
ipcMain.removeHandler('scan-desktop');
ipcMain.handle('scan-desktop', () => {
  if (scanFails) throw new Error('Desktop unavailable');
  return { items: [
    { name: 'Editor', target: 'C:\\Apps\\Editor.lnk', glyph: 'E', color: 'blue' },
    { name: 'Editor duplicate', target: 'c:/apps/editor.lnk', glyph: 'E', color: 'blue' },
    { name: 'Shared', target: 'C:\\Users\\Public\\Desktop\\Shared.url', glyph: 'S', color: 'blue' },
  ] };
});
ipcMain.removeHandler('pick-target');
let selection = { target: 'D:\\Tools\\手动入口.exe', name: '手动入口' };
ipcMain.handle('pick-target', () => selection);

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const errors = [];
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  try {
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    await win.webContents.executeJavaScript('window.dockReady');
    const initial = await win.webContents.executeJavaScript(`(() => {
      const footer = document.querySelector('.dock-footer').getBoundingClientRect();
      return { count: document.querySelectorAll('.dock-item[data-id]').length, bottom: footer.bottom, height: innerHeight };
    })()`);
    assert.equal(initial.count, 7);
    assert.equal(await win.webContents.executeJavaScript("libraryItems.length"), 2);
    assert.ok(initial.bottom <= initial.height, JSON.stringify(initial));
    const systemInfoDefault = await win.webContents.executeJavaScript(`(() => ({
      disabled: document.querySelector('.dock-shell').classList.contains('system-info-disabled'),
      checked: document.querySelector('#systemInfoToggle').checked,
    }))()`);
    assert.deepEqual(systemInfoDefault, { disabled: true, checked: false });
    const recycleBinDefault = await win.webContents.executeJavaScript(`({
      checked: document.querySelector('#recycleBinToggle').checked,
      visible: Boolean(document.querySelector('[data-system-id="recycle-bin"]')),
      label: document.querySelector('[data-system-id="recycle-bin"] .dock-label')?.textContent,
    })`);
    assert.deepEqual(recycleBinDefault, { checked: true, visible: true, label: '回收站' });
    await win.webContents.executeJavaScript(`document.querySelector('#recycleBinToggle').click()`);
    assert.equal(await win.webContents.executeJavaScript('Boolean(document.querySelector("[data-system-id=\\"recycle-bin\\"]"))'), false);
    assert.equal(await win.webContents.executeJavaScript('JSON.parse(localStorage.getItem("lume-dock-settings-v1")).showRecycleBin'), false);
    await win.webContents.executeJavaScript(`document.querySelector('#recycleBinToggle').click()`);
    assert.equal(await win.webContents.executeJavaScript('Boolean(document.querySelector("[data-system-id=\\"recycle-bin\\"]"))'), true);
    const glassDefault = await win.webContents.executeJavaScript(`(() => ({
      radius: document.querySelector('#glassRadius').value,
      opacity: document.querySelector('#glassOpacity').value,
      blur: document.querySelector('#glassBlur').value,
      highlight: document.querySelector('#glassHighlight').value,
      shadow: document.querySelector('#glassShadow').value,
      cssRadius: document.querySelector('.dock-shell').style.getPropertyValue('--dock-radius'),
      cssBlur: document.querySelector('.dock-shell').style.getPropertyValue('--dock-blur'),
    }))()`);
    assert.deepEqual(glassDefault, { radius: '22', opacity: '35', blur: '28', highlight: '65', shadow: '24', cssRadius: '22px', cssBlur: '28px' });
    await win.webContents.executeJavaScript(`(() => {
      const values = { glassRadius: 34, glassOpacity: 52, glassBlur: 11, glassHighlight: 80, glassShadow: 41 };
      for (const [id, value] of Object.entries(values)) {
        const input = document.querySelector('#' + id);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    const glassChanged = await win.webContents.executeJavaScript(`(() => {
      const shell = document.querySelector('.dock-shell');
      const saved = JSON.parse(localStorage.getItem('lume-dock-settings-v1'));
      return {
        radius: shell.style.getPropertyValue('--dock-radius'),
        opacity: shell.style.getPropertyValue('--dock-opacity'),
        blur: shell.style.getPropertyValue('--dock-blur'),
        highlight: shell.style.getPropertyValue('--dock-highlight'),
        shadow: shell.style.getPropertyValue('--dock-shadow-opacity'),
        saved: { glassRadius: saved.glassRadius, glassOpacity: saved.glassOpacity, glassBlur: saved.glassBlur, glassHighlight: saved.glassHighlight, glassShadow: saved.glassShadow },
      };
    })()`);
    assert.deepEqual(glassChanged, {
      radius: '34px', opacity: '0.52', blur: '11px', highlight: '0.8', shadow: '0.41',
      saved: { glassRadius: 34, glassOpacity: 52, glassBlur: 11, glassHighlight: 80, glassShadow: 41 },
    });
    const glassReloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.reload();
    await glassReloaded;
    await win.webContents.executeJavaScript('window.dockReady');
    assert.deepEqual(await win.webContents.executeJavaScript(`(() => ({
      radius: document.querySelector('#glassRadius').value,
      opacity: document.querySelector('#glassOpacity').value,
      blur: document.querySelector('#glassBlur').value,
      cssRadius: document.querySelector('.dock-shell').style.getPropertyValue('--dock-radius'),
    }))()`), { radius: '34', opacity: '52', blur: '11', cssRadius: '34px' });
    await win.webContents.executeJavaScript(`document.querySelector('#systemInfoToggle').click()`);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.dock-shell').classList.contains('system-info-disabled')`), false);
    await win.webContents.executeJavaScript(`(() => { const select = document.querySelector('#themeSelect'); select.value = 'light'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await win.webContents.executeJavaScript(`document.documentElement.dataset.theme`), 'light');
    assert.equal(await win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('lume-dock-settings-v1')).theme`), 'light');
    await win.webContents.executeJavaScript(`(() => { const select = document.querySelector('#themeSelect'); select.value = 'dark'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await win.webContents.executeJavaScript(`document.documentElement.dataset.theme`), 'dark');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const preview = await win.capturePage();
    fs.mkdirSync(path.join(__dirname, '../docs'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '../docs/dock-preview.png'), preview.toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('#settingsButton').click()`);
    assert.equal(win.getBounds().height, 188);
    const settingsWin = BrowserWindow.getAllWindows().find(candidate => candidate !== win);
    assert.ok(settingsWin);
    if (settingsWin.webContents.isLoading()) await new Promise(resolve => settingsWin.webContents.once('did-finish-load', resolve));
    await settingsWin.webContents.executeJavaScript('window.dockReady');
    const state = await settingsWin.webContents.executeJavaScript(`(() => {
      document.querySelector('#addButton').click();
      const opened = document.querySelector('#addDialog').open;
      document.querySelector('.dialog-actions .cancel-button').click();
      return { opened, closed: !document.querySelector('#addDialog').open, settings: document.querySelector('#settingsPanel').classList.contains('is-open') };
    })()`);
    assert.deepEqual(state, { opened: true, closed: true, settings: true });
    // Scan results remain searchable; pinning is explicit and rescans do not re-pin.
    await win.webContents.executeJavaScript(`items.push({...libraryItems.find(item => item.name === 'Editor'), id:'pinned-editor'}); save(); renderDock()`);
    await win.webContents.executeJavaScript(`(() => {
      renderManageList();
      const id = items.find((item) => item.name === 'Editor').id;
      document.querySelector('[data-id="' + id + '"] .remove-item').click();
    })()`);
    await win.webContents.executeJavaScript('scanDesktop({ automatic: true })');
    assert.equal(await win.webContents.executeJavaScript('items.length'), 7);
    const removalReloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.reload();
    await removalReloaded;
    await win.webContents.executeJavaScript('window.dockReady');
    assert.equal(await win.webContents.executeJavaScript('items.length'), 7);
    await win.webContents.executeJavaScript('document.querySelector("#settingsButton").click()');
    await win.webContents.executeJavaScript('scanDesktop()');
    assert.equal(await win.webContents.executeJavaScript('items.length'), 7);
    await win.webContents.executeJavaScript(`document.querySelector('#addButton').click(); pickTarget('file')`);
    const filled = await win.webContents.executeJavaScript(`({ name: document.querySelector('[name="name"]').value, target: document.querySelector('[name="target"]').value })`);
    assert.deepEqual(filled, selection);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const addPreview = await win.capturePage();
    fs.writeFileSync(path.join(__dirname, '../docs/add-preview.png'), addPreview.toPNG());
    selection = { canceled: true };
    await win.webContents.executeJavaScript('pickTarget("folder")');
    assert.equal(await win.webContents.executeJavaScript('document.querySelector("[name=target]").value'), filled.target);
    await win.webContents.executeJavaScript('document.querySelector("#addForm").requestSubmit()');
    assert.equal(await win.webContents.executeJavaScript('items.length'), 8);
    selection = filled;
    await win.webContents.executeJavaScript('document.querySelector("#addButton").click(); pickTarget("file")');
    await win.webContents.executeJavaScript('document.querySelector("#addForm").requestSubmit()');
    assert.equal(await win.webContents.executeJavaScript('items.length'), 8);
    assert.match(await win.webContents.executeJavaScript('document.querySelector("#addError").textContent'), /已在程序坞/);
    await win.webContents.executeJavaScript('document.querySelector(".dialog-actions .cancel-button").click()');
    await win.webContents.executeJavaScript('scanDesktop()');
    assert.equal(await win.webContents.executeJavaScript('items.length'), 8);
    // Reload proves both imported and manually added items were saved.
    const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.reload();
    await loaded;
    await win.webContents.executeJavaScript('window.dockReady');
    assert.equal(await win.webContents.executeJavaScript('items.length'), 8);
    scanFails = true;
    await win.webContents.executeJavaScript('scanDesktop()');
    assert.equal(await win.webContents.executeJavaScript('document.querySelector("#importButton").disabled'), false);
    assert.match(await win.webContents.executeJavaScript('document.querySelector("#toast").textContent'), /扫描失败/);
    await win.webContents.executeJavaScript('document.querySelector("#settingsButton").click()');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const settingsPreview = await settingsWin.capturePage();
    fs.writeFileSync(path.join(__dirname, '../docs/settings-preview.png'), settingsPreview.toPNG());
    await win.webContents.executeJavaScript(`(() => {
      for (let i = 0; i < 30; i++) items.push({ id: 'test-' + i, name: 'Test', target: 'https://example.com/test-' + i, glyph: 'T', color: 'blue' });
      renderDock();
    })()`);
    const overflow = await win.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('#dockRow');
      return row.scrollWidth > row.clientWidth && getComputedStyle(row).overflowX === 'auto';
    })()`);
    assert.equal(overflow, true);
    const transfer = await win.webContents.executeJavaScript(`(() => {
      const before = items.length;
      const buttons = ['#exportConfigButton', '#importConfigButton'].every((selector) => Boolean(document.querySelector(selector)));
      const added = addDroppedTargets(['C:\\\\Tools\\\\Dropped App.exe', 'C:\\\\Tools\\\\Dropped App.exe']);
      return { buttons, added, count: items.length, target: items.at(-1)?.target };
    })()`);
    assert.deepEqual(transfer, { buttons: true, added: 1, count: 39, target: 'C:\\Tools\\Dropped App.exe' });
    const configShape = await win.webContents.executeJavaScript(`(() => {
      const payload = exportPayload();
      const imported = validImportedItems([{ name: 'Imported', target: 'D:\\\\Apps\\\\Imported.exe', color: 'blue' }, { name: 'bad' }]);
      return { format: payload.format, version: payload.version, hasSettings: Boolean(payload.settings), imported: imported.length, importedTarget: imported[0]?.target };
    })()`);
    assert.deepEqual(configShape, { format: 'lume-dock-config', version: 1, hasSettings: true, imported: 1, importedTarget: 'D:\\Apps\\Imported.exe' });
    assert.deepEqual(errors, []);
    console.log('Electron UI smoke passed: automatic scan, deduplication, removal, manual rescan, picker, cancel, manual add, persistence, scan failure, dock layout');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
