const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lume-import-ui-')));
require('../main');
let enabled = false;
let failToggle = false;
let pending = [];
const acknowledgements = [];
const source = 'C:\\Users\\Demo\\Desktop\\Editor.lnk';
for (const channel of ['desktop-integration:status','desktop-integration:set','desktop-integration:pending','desktop-integration:ack','scan-desktop']) ipcMain.removeHandler(channel);
ipcMain.handle('desktop-integration:status', () => ({ enabled, supported: true }));
ipcMain.handle('desktop-integration:set', (_event, value) => {
  if (!failToggle) enabled = value;
  return { ok: !failToggle, enabled, supported: true, message: failToggle ? '测试注册失败' : '' };
});
ipcMain.handle('desktop-integration:pending', () => ({ items: pending }));
ipcMain.handle('desktop-integration:ack', async (_event, id) => {
  const record = pending.find(item => item.id === id);
  const saved = await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`JSON.parse(localStorage.getItem('lume-dock-items-v1')).some(item => item.target === ${JSON.stringify(record.target)})`);
  assert.equal(saved, true, 'acknowledge only after the archive target is saved');
  acknowledgements.push(id);
  pending = pending.filter(item => item.id !== id);
  return { ok: true };
});
ipcMain.handle('scan-desktop', () => ({ items: [{ name: 'Editor', target: source }] }));
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const js = source => win.webContents.executeJavaScript(source);
  async function until(source) {
    for (let attempt=0;attempt<100;attempt++) {
      if (await js(source)) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.fail('Timed out: '+source);
  }
  try {
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await js('window.dockReady');
    await js('document.querySelector("#settingsButton").click()');
    await until('!document.querySelector("#desktopIntegrationToggle").disabled');
    assert.equal(await js('document.querySelector("#desktopIntegrationToggle").checked'), false);
    failToggle = true;
    await js('document.querySelector("#desktopIntegrationToggle").click()');
    await until('!document.querySelector("#desktopIntegrationToggle").disabled');
    assert.equal(await js('document.querySelector("#desktopIntegrationToggle").checked'), false);
    failToggle = false;
    await js('document.querySelector("#desktopIntegrationToggle").click()');
    await until('!document.querySelector("#desktopIntegrationToggle").disabled');
    assert.equal(enabled, true);
    const entry = { id:'receipt-1', name:'Editor', source, target:'C:\\Lume Data\\Shortcuts\\receipt-1.lnk' };
    const count = await js('items.length');
    pending = [entry];
    win.webContents.send('desktop-imports-changed');
    await until(`items.some(item => item.target === ${JSON.stringify(entry.target)})`);
    await until('!importPending');
    assert.deepEqual(acknowledgements, ['receipt-1']);
    assert.equal(await js('items.length'), count+1);
    assert.equal(await js(`items.filter(item => item.target === ${JSON.stringify(source)}).length`), 0);
    assert.equal(await js(`items.filter(item => item.target === ${JSON.stringify(entry.target)}).length`), 1);
    await js('scanDesktop({automatic:true})');
    assert.equal(await js('items.length'), count+1);
    // A storage failure must leave pending imports unacknowledged and retain the previous UI state.
    await js(`window.originalSetItem=Storage.prototype.setItem; void(Storage.prototype.setItem=function(){throw new Error('Quota exceeded')})`);
    pending = [{ id:'receipt-2', name:'New App', source:'C:\\Users\\Demo\\Desktop\\New App.url', target:'C:\\Lume Data\\Shortcuts\\receipt-2.url' }];
    await js('receiveDesktopImports()');
    assert.equal(acknowledgements.length, 1);
    assert.equal(await js('items.length'), count+1);
    await js('void(Storage.prototype.setItem=window.originalSetItem)');
    await js('receiveDesktopImports()');
    assert.equal(acknowledgements.length, 2);
    assert.equal(await js('items.length'), count+2);
    const reloaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.reload(); await reloaded; await js('window.dockReady');
    assert.equal(await js('items.length'), count+2);
    assert.equal(await js('document.querySelector("#desktopIntegrationToggle").checked'), true);
    await js('document.querySelector("#settingsButton").click()');
    await new Promise(resolve => setTimeout(resolve,250));
    fs.writeFileSync(path.join(__dirname,'../docs/context-menu-settings.png'), (await win.capturePage()).toPNG());
    await js('document.querySelector("#desktopIntegrationToggle").click()');
    await until('!document.querySelector("#desktopIntegrationToggle").disabled');
    assert.equal(enabled, false);
    assert.equal(await js('items.length'), count+2);
    console.log('Desktop integration UI passed: toggle rollback, persisted setting, event delivery, durable-save-before-ack, replacement, scan dedup, storage failure, retry, reload and disable');
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
