const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lume-launcher-')));
require('../main');
let fail = false;
let failLaunch = false;
let requests = 0;
const launched = [];
const names = ['Google Chrome', '微信', 'QQ', 'Visual Studio Code', 'Windows Terminal', '计算器', '画图', '截图工具', 'Microsoft Edge', 'Microsoft Word', 'Microsoft Excel', 'Microsoft PowerPoint', '网易云音乐', '腾讯会议', '钉钉', '飞书', '7-Zip', 'Notepad++', 'OBS Studio', 'Steam', '设置', '相机', '照片', '录音机'];
const records = names.map((name, index) => ({ id: `test-app-${index}`, name, target: `apps-folder:Test_${index}!App`, source: '测试应用' }));
ipcMain.removeHandler('list-apps');
ipcMain.handle('list-apps', async () => {
  requests++;
  await new Promise((resolve) => setTimeout(resolve, 60));
  if (fail) throw new Error('Test catalog unavailable');
  return { items: records, warnings: [] };
});
ipcMain.removeHandler('scan-desktop');
ipcMain.handle('scan-desktop', () => ({ items: [] }));
ipcMain.removeHandler('open-target');
ipcMain.handle('open-target', (_event, target) => {
  launched.push(target);
  return failLaunch ? { ok: false, message: '测试启动失败' } : { ok: true };
});

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const errors = [];
  win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
  const js = (source) => win.webContents.executeJavaScript(source);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 180));
  async function query(value) {
    await js(`(() => { const input = document.querySelector('#appSearch'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  async function screenshot(name) {
    await pause();
    fs.mkdirSync(path.join(__dirname, '../docs'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '../docs', name), (await win.capturePage()).toPNG());
  }
  try {
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    await js('window.dockReady');
    // Actual button click opens the launcher and moves focus into the search.
    await js('document.querySelector("#appsButton").click()');
    await pause();
    assert.equal(await js('document.querySelector("#launcherPanel").hidden'), false);
    assert.equal(await js('document.activeElement.id'), 'appSearch');
    assert.equal(win.getBounds().height, Math.min(740, require('electron').screen.getPrimaryDisplay().workArea.height - 16));
    assert.equal(await js('document.querySelectorAll(".app-cell").length'), 27, await js('document.querySelector("#launcherStatus").textContent'));
    await screenshot('launcher-preview.png');
    // English name matching is case-insensitive; Chinese names are searchable.
    await query('cHrOmE');
    assert.equal(await js('document.querySelectorAll(".app-cell").length'), 1);
    assert.equal(await js('document.querySelector(".app-name").textContent'), 'Google Chrome');
    await query('微信');
    assert.equal(await js('document.querySelector(".app-name").textContent'), '微信');
    await screenshot('launcher-search-preview.png');
    await query('an-app-that-does-not-exist');
    assert.equal(await js('document.querySelector("#launcherEmpty").hidden'), false);
    // IME Enter must not start an app before the Chinese text is committed.
    await query('微信');
    await js('document.querySelector("#appSearch").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }))');
    assert.equal(launched.length, 0);
    // Pinning changes both the dock and the filtered pinned list.
    await js('document.querySelector(".app-pin").click()');
    assert.equal(await js('items.filter((item) => item.name === "微信").length'), 1);
    assert.equal(await js('document.querySelector(".app-pin").disabled'), false);
    await js('document.querySelector(".app-pin").click()');
    assert.equal(await js('items.some(item => item.name === "微信")'), false);
    assert.equal(await js('document.querySelector(".app-pin").getAttribute("aria-pressed")'), 'false');
    await js('document.querySelector(".app-pin").click()');
    await js('document.querySelector("[data-filter=pinned]").click()');
    assert.equal(await js('document.querySelectorAll(".app-cell").length'), 1);
    await query('');
    assert.equal(await js('document.querySelectorAll(".app-cell").length'), 4);
    // Keyboard Down enters the grid; Up in its first row returns to search.
    await js('document.querySelector("#appSearch").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))');
    assert.equal(await js('document.activeElement.className'), 'app-open');
    await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }))');
    assert.equal(await js('document.activeElement.id'), 'appSearch');
    // Failed refresh and failed launch preserve a usable panel.
    fail = true;
    await js('launcher.refresh()');
    assert.match(await js('document.querySelector("#launcherStatus").textContent'), /读取失败/);
    assert.equal(await js('document.querySelectorAll(".app-cell").length'), 4);
    assert.equal(await js('document.querySelector("#refreshApps").disabled'), false);
    fail = false;
    await js('launcher.refresh()');
    assert.ok(requests >= 3);
    await query('微信');
    failLaunch = true;
    await js('document.querySelector(".app-open").click()');
    await pause();
    assert.equal(await js('document.querySelector("#launcherPanel").hidden'), false);
    assert.match(await js('document.querySelector("#toast").textContent'), /启动失败/);
    // Enter launches the exact AppsFolder target and returns to the dock.
    failLaunch = false;
    await js('document.querySelector("#appSearch").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))');
    await pause();
    assert.equal(launched.at(-1), 'apps-folder:Test_1!App');
    assert.equal(await js('document.querySelector("#launcherPanel").hidden'), true);
    assert.equal(win.getBounds().height, 188);
    await js('launcher.open()');
    await js('document.querySelector("[data-filter=recent]").click()');
    assert.equal(await js('document.querySelectorAll(".app-cell").length'), 1);
    assert.equal(await js('document.querySelector(".app-name").textContent'), '微信');
    assert.equal(await js('JSON.parse(localStorage.getItem("lume-dock-recent-v1")).length'), 1);
    await js('launcher.close()');
    // The launcher button is permanent even after changing fixed entries.
    await js('launcher.open()');
    await query('微信');
    await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
    assert.equal(await js('document.querySelector("#appSearch").value'), '');
    assert.equal(await js('document.querySelector("#launcherPanel").hidden'), false);
    await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
    assert.equal(await js('document.querySelector("#launcherPanel").hidden'), true);
    const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.reload(); await reloaded; await js('window.dockReady');
    assert.equal(await js('items.filter((item) => item.name === "微信").length'), 1);
    await js('launcher.open()');
    // A narrow dock still has a scrollable, unclipped grid.
    win.setBounds({ ...win.getBounds(), width: 720 });
    await pause();
    const layout = await js(`(() => {
      const grid = document.querySelector('#appGrid');
      const panel = document.querySelector('#launcherPanel').getBoundingClientRect();
      return { fits: panel.right <= innerWidth, scrolls: grid.scrollHeight > grid.clientHeight, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length };
    })()`);
    assert.ok(layout.fits && layout.scrolls && layout.columns >= 4);
    await screenshot('launcher-narrow-preview.png');
    await js(`(() => {
      document.querySelector('#launcherAdd').click();
      const form = document.querySelector('#addForm');
      form.elements.name.value = '绿色软件';
      form.elements.target.value = 'D:\\\\Portable\\\\MyApp.exe';
      form.requestSubmit();
    })()`);
    assert.equal(await js('document.querySelector("#addDialog").open'), false);
    assert.equal(await js('document.querySelector("#launcherPanel").hidden'), false);
    await query('绿色软件');
    assert.equal(await js('document.querySelectorAll(".app-cell").length'), 1);
    assert.equal(await js('document.querySelector(".app-name").textContent'), '绿色软件');
    assert.deepEqual(errors, []);
    console.log('Launcher UI passed: button, grid, Chinese/English search, empty, IME, pin, filters, keyboard, refresh recovery, failed/successful launch, persistence and 720px layout');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
