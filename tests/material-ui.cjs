const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'lume-material-')));
require('../main');
const artwork='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../renderer/assets/macos/music.png')).toString('base64');
const reads=[];
for(const name of ['get-icon','list-apps','scan-desktop']) ipcMain.removeHandler(name);
ipcMain.handle('get-icon',(_event,target)=>{reads.push(target);return artwork;});
ipcMain.handle('scan-desktop',()=>({items:[]}));
ipcMain.handle('list-apps',()=>({items:[{id:'native',name:'Native app',target:'apps-folder:Vendor.Native',icon:artwork,iconVersion:2}],identities:[]}));
const pause=()=>new Promise(resolve=>setTimeout(resolve,200));
setTimeout(()=>{console.error('Material UI timed out');app.exit(1);},45000).unref();
app.whenReady().then(async()=>{
 const win=BrowserWindow.getAllWindows()[0], js=source=>win.webContents.executeJavaScript(source);
 try {
  if(win.webContents.isLoading()) await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  await js('window.dockReady');
  await js(`localStorage.setItem('lume-dock-items-v1',JSON.stringify([{id:'old-native',name:'Native app',target:'apps-folder:Vendor.Native',icon:'data:image/png;base64,AAAA'}]))`);
  const loaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));win.reload();await loaded;
  await js('window.dockReady');await pause();
  assert.ok(reads.includes('apps-folder:Vendor.Native'),'old pin automatically requests fresh artwork');
  assert.equal(await js('document.querySelector("[data-id=old-native] img").src'),artwork);
  assert.equal(await js('items[0].id'),'old-native','pin survives cache invalidation');
  await js('launcher.open()');await js('document.querySelector(".app-pin").click();document.querySelector(".app-pin").click()');
  assert.equal(await js('items[0].iconVersion'),2,'re-pinned artwork has corrected cache version');
  await js('launcher.close();document.activeElement.blur();dockMotion.reset();settings.magnify=false;applyDockPreferences()');
  const css=await win.webContents.insertCSS('.dock-row { visibility:hidden !important }');
  for(const [size,opacity,blur,radius] of [[40,10,0,8],[64,35,28,22],[72,75,48,40]]) {
   for(const theme of ['light','dark']) {
    await js(`settings.iconSize=${size};settings.glassOpacity=${opacity};settings.glassBlur=${blur};settings.glassRadius=${radius};settings.theme='${theme}';applyDockPreferences();applyGlassSettings();document.documentElement.dataset.theme='${theme}'`);
    await pause();
    const rect=await js(`(()=>{const d=document.querySelector('#dock'),r=d.getBoundingClientRect(),s=getComputedStyle(d,'::before');return {x:r.x+parseFloat(s.left)+(parseFloat(s.width)/2),y:r.y+parseFloat(s.top)+(parseFloat(s.height)/2),height:innerHeight,width:innerWidth,transform:s.transform};})()`);
    assert.equal(rect.transform,'none','backdrop stays unscaled during magnification');
    const capture=await win.capturePage(), dimensions=capture.getSize(), pixels=capture.toBitmap();
    const sx=dimensions.width/rect.width, sy=dimensions.height/rect.height;
    const sample=y=>{const offset=(Math.round(y*sy)*dimensions.width+Math.round(rect.x*sx))*4;return [...pixels.subarray(offset,offset+4)];};
    const above=sample(rect.y-1), middle=sample(rect.y), below=sample(rect.y+1);
    assert.ok(above[3]>0,'glass interior is rendered');
    for(let channel=0;channel<4;channel++) assert.ok(Math.abs(middle[channel]-above[channel])<=3 && Math.abs(below[channel]-middle[channel])<=3,'unexpected mid-shelf seam: '+JSON.stringify({size,theme,above,middle,below}));
   }
  }
  await win.webContents.removeInsertedCSS(css);
  await js('settings=normalizeSettings({});applyDockPreferences();applyGlassSettings();items=defaults;renderDock();document.querySelector("#toast").style.display="none"');await pause();
  fs.writeFileSync(path.join(__dirname,'../docs/material-0.12.8.png'),(await win.capturePage()).toPNG());
  console.log('Material UI passed: stale pin refresh, corrected pin cache, six size/theme/material combinations, continuous center pixels and unscaled backdrop.');app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
