const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lume-dedup-')));
require('../main');
const artwork = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname,'../renderer/assets/macos/music.png')).toString('base64');
const catalog = [
  {id:'app:pot',name:'PotPlayer 64 bit',target:'apps-folder:Vendor.Player',icon:artwork,source:'已安装应用'},
  {id:'start:pot',name:'PotPlayer',target:'C:/Start/Player.lnk',source:'开始菜单'},
  {id:'app:qq',name:'QQ音乐',target:'apps-folder:Vendor.Music',icon:artwork,source:'已安装应用'},
  {id:'other:pot',name:'PotPlayer 32 bit',target:'C:/Apps32/Player.exe'},
  {id:'profile:pot',name:'PotPlayer 工作配置',target:'C:/Start/Profile.lnk'},
  {id:'broken:pot',name:'PotPlayer 64 bit',target:'C:/Broken/Player.lnk'},
  {id:'manual:pot',name:'PotPlayer 使用说明',target:'C:/Docs/Player.pdf'},
];
const aliases = [
  ['apps-folder:Vendor.Player',['app:player']], ['C:/Start/Player.lnk',['app:player','exe:player']],
  ['C:/Desktop/Player.lnk',['exe:player']], ['apps-folder:Vendor.Music',['app:music']], ['C:/Desktop/Music.lnk',['app:music']],
  ['C:/Apps32/Player.exe',['exe:player32']], ['C:/Start/Profile.lnk',['exe:player-profile']],
];
let requests = [], fail = false;
const launched = [];
for (const name of ['list-apps','scan-desktop','get-icon','open-target']) ipcMain.removeHandler(name);
ipcMain.handle('list-apps',(_event,options)=>{
  requests.push(options);
  if(fail)throw Error('Injected identity/catalog failure');
  return {items:catalog,identities:aliases.map(([source,identity])=>({source,identity}))};
});
ipcMain.handle('scan-desktop',()=>({items:[{name:'播放器桌面版',target:'C:/Desktop/Player.lnk'},{name:'QQ音乐',target:'C:/Desktop/Music.lnk'}]}));
ipcMain.handle('get-icon',()=>null);
ipcMain.handle('open-target',(_event,target)=>{launched.push(target);return {ok:true};});
const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
setTimeout(()=>{console.error('Dedup test timed out');app.exit(1);},45000).unref();
app.whenReady().then(async()=>{
 const dock=BrowserWindow.getAllWindows()[0], js=async source=>{try{return await dock.webContents.executeJavaScript(source);}catch(error){console.error('Source:',source);throw error;}};
 const query=async text=>js(`appSearch.value=${JSON.stringify(text)};appSearch.dispatchEvent(new Event('input'))`);
 const cells=()=>js('document.querySelectorAll(".app-cell").length');
 try {
  if(dock.webContents.isLoading())await new Promise(resolve=>dock.webContents.once('did-finish-load',resolve));
  await js('window.dockReady;');
  await js('commitItems([...items,{id:"pinned-desktop",name:"播放器桌面版",target:"C:/Desktop/Player.lnk"},{id:"pinned-start",name:"PotPlayer",target:"C:/Start/Player.lnk"}]);renderDock();recordRecent({name:"播放器桌面版",target:"C:/Desktop/Player.lnk"});launcher.open()');
  assert.ok(requests[0].targets.includes('C:/Desktop/Player.lnk'));
  await query('播放器桌面版');assert.equal(await cells(),1);
  assert.equal(await js('document.querySelector(".app-name").textContent'),'PotPlayer 64 bit','prefer registered name and real artwork');
  assert.equal(await js('document.querySelector(".app-art img").src'),artwork);
  assert.equal(await js('document.querySelector(".app-pin").getAttribute("aria-pressed")'),'true','any pinned alias marks the merged app');
  await js('document.querySelector("[data-filter=recent]").click()');assert.equal(await cells(),1,'recent shortcut maps to the merged app');
  await js('document.querySelector("[data-filter=pinned]").click()');assert.equal(await cells(),1,'two pinned aliases appear once');
  await js('window.savedSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error("Quota")};document.querySelector(".app-pin").click();void(Storage.prototype.setItem=window.savedSetItem)');
  assert.equal(await cells(),1);assert.equal(await js('items.filter(item=>item.id.startsWith("pinned-")).length'),2,'failed unpin keeps all aliases');
  await js('document.querySelector(".app-pin").click()');assert.equal(await cells(),0);
  assert.equal(await js('items.some(item=>item.target==="C:/Desktop/Player.lnk"||item.target==="C:/Start/Player.lnk")'),false,'one unpin removes all equivalent pins atomically');
  await js('document.querySelector("[data-filter=all]").click()');assert.equal(await cells(),1,'unpin keeps the merged search entry');
  await js('document.querySelector(".app-pin").click()');assert.equal(await js('items.filter(item=>item.target==="apps-folder:Vendor.Player").length'),1);
  await query('QQ音乐');assert.equal(await cells(),1);
  await query('PotPlayer');assert.equal(await cells(),3,'apps preserve distinct exe/version/arguments');
  await js('document.querySelector("[data-kind=shortcuts]").click()');assert.equal(await cells(),2,'unresolved link and document are separate from apps');
  assert.equal(await js('appSearch.value'),'PotPlayer','switching category preserves query');
  await query('播放器桌面版');assert.equal(await cells(),0,'merged program shortcut appears only under apps');
  assert.match(await js('launcherEmptyCopy.textContent'),/应用.*1.*匹配/);
  await js('document.querySelector("[data-kind=apps]").click()');assert.equal(await cells(),1);
  
  fail=true;await js('launcher.refresh()');await query('播放器桌面版');assert.equal(await cells(),1,'failed refresh preserves identities');fail=false;
  await js('launcher.refresh()');assert.equal(requests.at(-1).refresh,true);
  await js('document.querySelector(".app-open").click()');await pause();assert.equal(launched.at(-1),'apps-folder:Vendor.Player','launch original selected target');
  await js('launcher.open()');await query('QQ音乐');assert.equal(await cells(),1);
  assert.equal(await js('libraryItems.some(item=>item.target==="C:/Desktop/Music.lnk")'),true,'display dedup leaves source records intact');
  console.log('App dedup UI passed: program aliases, artwork, alias search, pinned/recent filters, atomic unpin/rollback, refresh recovery and exact launch target.');app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
