const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lume-categories-')));
require('../main');
const catalog = [
  { name:'分类工具', target:'apps-folder:Category.App' },
  { name:'分类桌面别名', target:'C:/Desktop/Category.lnk' },
  { name:'分类绿色程序', target:'D:/Portable/Category.exe' },
  { name:'分类启动配置', target:'C:/Start/Profile.lnk' },
  { name:'分类在线安装', target:'C:/Start/Category.appref-ms' },
  { name:'分类网站', target:'https://example.com/category' },
  { name:'分类工具', target:'C:/Docs/Category.pdf' },
  { name:'分类文件夹', target:'C:/Folders/Category' },
  { name:'分类未识别', target:'C:/Broken/Category.lnk' },
].map((item, index) => ({id:'category-'+index, ...item}));
let requests = 0;
const launched = [];
for (const name of ['list-apps','scan-desktop','get-icon','open-target']) ipcMain.removeHandler(name);
ipcMain.handle('list-apps', () => {
  requests++;
  return { items:catalog, identities:[
    { source:'apps-folder:Category.App', identity:['app:category'] },
    { source:'C:/Desktop/Category.lnk', identity:['app:category','exe:category'] },
    { source:'C:/Start/Profile.lnk', identity:['exe:category-profile'] },
  ] };
});
ipcMain.handle('scan-desktop', () => ({items:[]}));
ipcMain.handle('get-icon', () => null);
ipcMain.handle('open-target', (_event, target) => { launched.push(target); return {ok:true}; });
const pause = (ms=80) => new Promise(resolve => setTimeout(resolve, ms));
setTimeout(() => { console.error('Category UI timed out'); app.exit(1); },45000).unref();
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const js = source => win.webContents.executeJavaScript(source);
  const query = text => js(`appSearch.value=${JSON.stringify(text)};appSearch.dispatchEvent(new Event('input'))`);
  const count = () => js('document.querySelectorAll(".app-cell").length');
  const category = kind => js(`document.querySelector('[data-kind="${kind}"]').click()`);
  const errors = [];
  win.webContents.on('console-message', event => { if(event.level==='error')errors.push(event.message); });
  try {
    if(win.webContents.isLoading())await new Promise(resolve => win.webContents.once('did-finish-load',resolve));
    await js('window.dockReady');await js('launcher.open()');
    await query('分类');
    assert.equal(await count(),4,'registered app, EXE, distinct program profile, ClickOnce');
    assert.equal(await js('document.querySelector("[data-kind=apps]").getAttribute("aria-pressed")'),'true');
    assert.equal(await js('appSearch.placeholder'),'搜索应用名称…');
    const firstRequests = requests;
    await category('shortcuts');
    assert.equal(await count(),4,'URL, PDF, directory and unresolved shortcut');
    assert.equal(await js('appSearch.value'),'分类');
    assert.equal(await js('appSearch.getAttribute("aria-label")'),'搜索快捷方式名称');
    assert.equal(await js('appGrid.getAttribute("aria-label")'),'快捷方式列表');
    await query('分类桌面别名');assert.equal(await count(),0);
    assert.match(await js('launcherEmptyCopy.textContent'),/应用.*1.*匹配/);
    await category('apps');assert.equal(await count(),1,'program alias searchable only in apps');
    await query('分类网站');assert.equal(await count(),0);
    assert.match(await js('launcherEmptyCopy.textContent'),/快捷方式.*1.*匹配/);
    await category('shortcuts');assert.equal(await count(),1);
    await js('document.querySelector(".app-edit-icon").click()');await pause();
    assert.equal(await js('iconDialog.open'),true,'shortcuts retain custom icon entry');
    assert.equal(await js('customIconName.textContent'),'分类网站');
    await js('document.querySelector("#closeIconDialog").click()');
    await js('document.querySelector(".app-pin").click();document.querySelector("[data-filter=pinned]").click()');
    assert.equal(await count(),1);assert.equal(await js('document.querySelector(".app-pin").getAttribute("aria-pressed")'),'true');
    await js('document.querySelector(".app-pin").click()');assert.equal(await count(),0);
    await js('document.querySelector("[data-filter=all]").click()');assert.equal(await count(),1,'unpin retains shortcut');
    await category('apps');assert.equal(await count(),0,'pinning does not reclassify URLs');
    await category('shortcuts');assert.equal(await count(),1);
    assert.equal(requests, firstRequests,'category/search/pin switches do not rescan');
    await js('appSearch.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');await pause();
    assert.equal(launched.at(-1),'https://example.com/category');
    await js('launcher.open()');await js('document.querySelector("[data-filter=recent]").click()');
    assert.equal(await count(),0,'shortcut history does not mix into apps');
    await category('shortcuts');assert.equal(await count(),1,'recent follows category');
    await js('document.querySelector("[data-filter=all]").click()');await query('分类');
    win.setBounds({...win.getBounds(),width:440});await pause(2600);
    for(const theme of ['dark','light']) {
      await js(`settings.theme='${theme}';applyTheme()`);await pause(100);
      win.setBounds({...win.getBounds(),width:440});await pause(200);
      assert.equal(await js('document.documentElement.dataset.theme'), theme);
      const layout = await js(`(() => {
        const tabs=document.querySelector('.launcher-kinds').getBoundingClientRect(), close=document.querySelector('#closeLauncher').getBoundingClientRect(), panel=launcherPanel.getBoundingClientRect();
        return {tabs:tabs.toJSON(),close:close.toJSON(),panel:panel.toJSON(),width:innerWidth,bodyOverflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      assert.equal(layout.width,440);
      assert.ok(layout.tabs.right<=layout.close.left,JSON.stringify(layout));
      assert.ok(layout.panel.right<=440 && !layout.bodyOverflow,JSON.stringify(layout));
      assert.equal(await count(),4);
      fs.writeFileSync(path.join(__dirname,`../docs/categories-0.12.10-${theme}.png`),(await win.capturePage()).toPNG());
    }
    await category('apps');assert.equal(await count(),4);
    await js('appSearch.focus();appSearch.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))');
    assert.equal(await js('document.activeElement.className'),'app-open');
    await js('launcher.close()');
    const loaded = new Promise(resolve => win.webContents.once('did-finish-load',resolve));win.reload();await loaded;
    await js('window.dockReady');await js('launcher.open()');
    await query('分类');assert.equal(await count(),4,'restart defaults to apps with same classification');
    await category('shortcuts');assert.equal(await count(),4);
    assert.deepEqual(errors,[]);
    console.log('Category UI passed: exclusive classification, alias dedup/search, cross-category hints, pin/unpin, icon editor, exact launch, recent isolation, no rescans, keyboard, restart and 440px dark/light.');
    app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
