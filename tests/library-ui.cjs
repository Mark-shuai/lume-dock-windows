const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lume-library-')));
require('../main');
let failScan = false;
const desktop = Array.from({length:80},(_,i)=>({name:`Desktop App ${String(i).padStart(2,'0')}`,target:`C:/Desktop/App-${i}.lnk`}));
for(const name of ['scan-desktop','list-apps','get-icon']) ipcMain.removeHandler(name);
ipcMain.handle('scan-desktop',()=>{if(failScan)throw new Error('Injected unavailable desktop');return {items:[...desktop,{...desktop[0],name:'Duplicate',target:'c:/desktop/app-0.lnk'}]};});
ipcMain.handle('list-apps',()=>({items:[]}));
ipcMain.handle('get-icon',()=>null);
const pause=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const dock=BrowserWindow.getAllWindows()[0];const js=async source=>{try{return await dock.webContents.executeJavaScript(source)}catch(error){console.error('Source:',source);throw error;}};
 async function until(source){for(let i=0;i<120;i++){if(await js(source))return;await pause();}throw new Error('Timed out: '+source);}
 async function reload(){const loaded=new Promise(resolve=>dock.webContents.once('did-finish-load',resolve));dock.reload();await loaded;await js('window.dockReady');}
 async function query(text){await js(`appSearch.value=${JSON.stringify(text)};appSearch.dispatchEvent(new Event('input'))`);}
 try{
  if(dock.webContents.isLoading())await new Promise(resolve=>dock.webContents.once('did-finish-load',resolve));
  await js('window.dockReady');
  assert.equal(await js('items.length'),7);assert.equal(await js('libraryItems.length'),80);
  await js('launcher.open()');await js('document.querySelector("[data-kind=shortcuts]").click()');await query('Desktop App 00');
  assert.equal(await js('document.querySelectorAll(".app-cell").length'),1);
  assert.equal(await js('document.querySelector(".app-pin").getAttribute("aria-pressed")'),'false');
  await js('document.querySelector(".app-pin").click()');assert.equal(await js('items.length'),8);
  assert.equal(await js('document.querySelector(".app-pin").getAttribute("aria-pressed")'),'true');
  // A failed save must preserve both the fixed entry and star state.
  await js(`window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('Quota')};document.querySelector('.app-pin').click();void(Storage.prototype.setItem=window.originalSetItem)`);
  assert.equal(await js('items.length'),8);assert.equal(await js('document.querySelector(".app-pin").getAttribute("aria-pressed")'),'true');
  await js('document.querySelector(".app-pin").click()');assert.equal(await js('items.length'),7);
  assert.equal(await js('document.querySelector(".app-cell")!==null'),true);
  await js('scanDesktop()');await js('launcher.close()');await reload();
  assert.equal(await js('items.length'),7);assert.equal(await js('libraryItems.length'),80);
  await js('launcher.open()');await js('document.querySelector("[data-kind=shortcuts]").click()');await query('Desktop App 00');assert.equal(await js('document.querySelector(".app-pin").getAttribute("aria-pressed")'),'false');
  await js('document.querySelector(".app-pin").click();document.querySelector("[data-filter=pinned]").click()');
  assert.equal(await js('document.querySelectorAll(".app-cell").length'),1);
  await js('document.querySelector(".app-pin").click()');assert.equal(await js('document.querySelectorAll(".app-cell").length'),0);
  await js('document.querySelector("[data-filter=all]").click()');assert.equal(await js('document.querySelectorAll(".app-cell").length'),1);
  await js('launcher.close();commitItems([...items,{id:"pinned-portable",name:"Portable Test",target:"D:/Portable/App.exe"}]);renderDock();launcher.open()');
  await js('document.querySelector("[data-kind=apps]").click()');await query('Portable Test');await js('document.querySelector(".app-pin").click()');
  assert.equal(await js('document.querySelectorAll(".app-cell").length'),1);assert.equal(await js('document.querySelector(".app-pin").getAttribute("aria-pressed")'),'false');
  await js('launcher.close()');await reload();await js('launcher.open()');await query('Portable Test');assert.equal(await js('document.querySelectorAll(".app-cell").length'),1);
  await js('document.querySelector(".app-pin").click()');await js('launcher.close()');
  // Keep explicit pins while migrating the precise IDs used by old automatic scans.
  await js('commitItems([...items,{id:"desktop-legacy",name:"Legacy Scan",target:"C:/Desktop/Legacy.lnk"}]);renderDock()');await reload();
  assert.equal(await js('items.some(item=>item.id==="desktop-legacy")'),false);
  assert.equal(await js('libraryItems.some(item=>item.target==="C:/Desktop/Legacy.lnk")'),true);
  assert.equal(await js('items.some(item=>item.name==="Portable Test")'),true);
  failScan=true;await js('scanDesktop()');assert.equal(await js('libraryItems.length'),82);assert.equal(await js('document.querySelector("#importButton").disabled'),false);failScan=false;
  await js('launcher.open()');await js('document.querySelector("[data-kind=shortcuts]").click()');await query('Legacy Scan');assert.equal(await js('document.querySelectorAll(".app-cell").length'),1);
  const exported=await js('exportPayload()');assert.equal(exported.libraryItems.length,82);
  await js('launcher.close();settings.autoHide=false;save();window.dockAPI.setAutoHide(false);openSettings()');
  const panel=BrowserWindow.getAllWindows().find(win=>win!==dock);
  if(panel.webContents.isLoading())await new Promise(resolve=>panel.webContents.once('did-finish-load',resolve));await panel.webContents.executeJavaScript('window.dockReady');
  await panel.webContents.executeJavaScript('scanDesktop()');await until('libraryItems.length===82');
  assert.equal(await panel.webContents.executeJavaScript('libraryItems.length'),82);
  panel.close();
  dock.webContents.debugger.attach('1.3');
  await dock.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  await until('document.hasFocus()');
  // A crowded shelf must clip inside its glass and remain navigable at each size.
  await js('commitItems([...items,...Array.from({length:60},(_,i)=>({id:"many-"+i,name:"Many "+i,target:"C:/Many/"+i+".exe"}))]);renderDock()');
  for(const size of [40,64,72]){
   await js(`settings.iconSize=${size};applyDockPreferences();dockMotion.refresh()`);await pause(200);
   dock.setBounds({width:720});await pause(250);
   assert.equal(await js('dockRow.classList.contains("is-scrollable")'),true);
   assert.equal(await js('document.querySelector("#dockScrollNext").hidden'),false);
   const moved=await js('dockRow.scrollLeft=0;dockRow.dispatchEvent(new WheelEvent("wheel",{deltaY:150,bubbles:true,cancelable:true}));dockRow.scrollLeft');assert.ok(moved>0);
   await js('dockRow.scrollLeft=0;document.querySelector("#dockScrollNext").click()');await pause(700);assert.ok(await js('dockRow.scrollLeft>0'));
   await js('dockRow.scrollLeft=100000');await pause(100);assert.equal(await js('document.querySelector("#dockScrollNext").disabled'),true);
   await js('document.querySelector("#dockScrollPrev").click()');await pause(700);assert.equal(await js('document.querySelector("#dockScrollNext").disabled'),false);
   for(const which of ['first','last']){
    await js(`document.activeElement.blur();document.querySelectorAll('.dock-icon')[${which==='first'?'0':"document.querySelectorAll('.dock-icon').length-1"}].focus({preventScroll:true})`);await pause(650);
    const b=await js(`(()=>{const icon=document.activeElement.querySelector('img').getBoundingClientRect(),r=dockRow.getBoundingClientRect(),d=document.querySelector('.dock').getBoundingClientRect();return {left:icon.left,right:icon.right,clipLeft:r.left,clipRight:r.right,glassLeft:d.left+74,glassRight:d.right-74}})()`);
    assert.ok(b.left>=b.clipLeft-.5&&b.right<=b.clipRight+.5,JSON.stringify(b));assert.ok(b.clipLeft>=b.glassLeft-.5&&b.clipRight<=b.glassRight+.5,JSON.stringify(b));
   }
  }
  await js('document.activeElement.blur();dockMotion.reset()');await pause(500);
  fs.writeFileSync(path.join(__dirname,'../docs/dock-overflow-0.12.4.png'),(await dock.capturePage()).toPNG());
  await dock.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await js('dockRow.scrollLeft=0');await pause(100);
  await js('document.querySelector("#dockScrollNext").click()');
  assert.ok(await js('dockRow.scrollLeft>0'),'reduced motion uses immediate paging');
  const backup=await js('JSON.stringify(items)');
  await js('commitItems(items.slice(0,3));renderDock()');await pause(100);
  assert.equal(await js('dockRow.classList.contains("is-scrollable")'),false);
  assert.equal(await js('document.getElementById("dockScrollPrev").hidden&&document.getElementById("dockScrollNext").hidden'),true);
  await js(`commitItems(${backup});renderDock()`);
  const count=await js('items.length');await reload();assert.equal(await js('items.length'),count);
  console.log('Library UI passed: scans catalog only, reversible stars, failure rollback, unpin retention, reload, precise legacy migration, floating sync, export, crowded shelf clipping/buttons/wheel/focus at 40/64/72px.');app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
