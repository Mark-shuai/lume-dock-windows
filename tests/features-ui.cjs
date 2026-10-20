const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lume-features-')));
require('../main');
const requests = [], icons = [], launches = [], fullscreen = [], acknowledgements = [];
let failRunning = false, config = {}, pending = [];
for (const name of ['scan-desktop','get-icon','list-apps','dock:running-targets','open-target','dock:set-fullscreen-hide','config:import','desktop-integration:pending','desktop-integration:ack']) ipcMain.removeHandler(name);
ipcMain.handle('scan-desktop', () => ({ items: [] }));
ipcMain.handle('list-apps', () => ({ items: [], warnings: [] }));
ipcMain.handle('get-icon', (_event,target) => { icons.push(target); return null; });
ipcMain.handle('open-target', (_event,target) => { launches.push(target); return {ok:true}; });
ipcMain.handle('dock:set-fullscreen-hide', (_event,enabled) => { fullscreen.push(enabled); });
ipcMain.handle('dock:running-targets', (_event,targets,refresh) => {
  requests.push({targets,refresh});
  if (failRunning) throw new Error('Injected process failure');
  return {targets:targets.filter(target => target.endsWith('Alpha.exe'))};
});
ipcMain.handle('config:import', () => ({ok:true,data:config}));
ipcMain.handle('desktop-integration:pending', () => ({items:pending}));
ipcMain.handle('desktop-integration:ack', (_event,id) => { acknowledgements.push(id); pending=pending.filter(entry=>entry.id!==id); return {ok:true}; });
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const js = async source => { try { return await win.webContents.executeJavaScript(source); } catch(error) { console.error('Renderer source:',source); throw error; } };
  const pause = (ms=100) => new Promise(resolve=>setTimeout(resolve,ms));
  async function until(source) { for(let i=0;i<100;i++) { if(await js(source)) return; await pause(30); } assert.fail('Timed out: '+source); }
  async function input(id,value) { await js('(function(){const c=document.getElementById('+JSON.stringify(id)+'); c.value='+JSON.stringify(value)+'; c.dispatchEvent(new Event("input",{bubbles:true}));})()'); }
  async function reload() { const loaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve)); win.reload(); await loaded; await js('window.dockReady'); await pause(); }
  try {
    if(win.webContents.isLoading()) await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
    await js('window.dockReady'); await pause();
    assert.equal(await js('settings.runningIndicators && settings.hideOnFullscreen'),true);
    assert.deepEqual(await js('[settings.iconSize,settings.dockWidth,settings.accentColor]'),[64,56,'#0A84FF']);
    await js('commitItems([{id:"alpha",name:"Alpha",target:"C:/Tools/Alpha.exe"},{id:"beta",name:"Beta",target:"C:/Tools/Beta.exe"},{id:"gamma",name:"Gamma",target:"C:/Tools/Gamma.exe"}]); renderDock(); syncRunningTimer()');
    await until('!runningPending'); await js('refreshRunningIndicators()');
    assert.equal(await js('document.querySelectorAll(".is-running").length'),1);
    await js('openSettings()'); assert.equal(await js('runningTimer!==null'),true);
    await input('iconSize','72'); await input('dockWidth','80');
    await js('document.querySelectorAll("[data-accent]")[1].click()');
    await input('accentColor','#aabbcc'); assert.equal(await js('settings.accentColor'),'#AABBCC');
    await js('document.querySelector("#hideOnFullscreenToggle").click(); document.querySelector("#runningIndicatorsToggle").click()');
    assert.equal(fullscreen.at(-1),false);
    await js('document.querySelector("#addSeparator").click()');
    assert.equal(await js('items.at(-1).type'),'separator');
    assert.equal(await js('document.querySelector(".dock-separator button")'),null);
    const beforeLaunch=launches.length; await js('openItem(items.at(-1).id)'); assert.equal(launches.length,beforeLaunch);
    await js('(function(){renderManageList();const r=document.querySelector("#manageList .manage-item:last-child");r.dispatchEvent(new Event("dragstart"));manageList.prepend(r);r.dispatchEvent(new Event("dragend"));})()');
    assert.equal(await js('items[0].type'),'separator');
    await reload();
    assert.deepEqual(await js('[settings.iconSize,settings.dockWidth,settings.accentColor,settings.runningIndicators,settings.hideOnFullscreen,items[0].type]'),[72,80,'#AABBCC',false,false,'separator']);
    await js('openSettings()'); await pause(350);
    fs.writeFileSync(path.join(__dirname,'../docs/features-settings.png'),(await BrowserWindow.getAllWindows().find(panel=>panel!==win).capturePage()).toPNG());
    await js('document.querySelector("#resetDockSize").click()'); assert.deepEqual(await js('[settings.iconSize,settings.dockWidth]'),[64,56]);
    config={settings:{iconSize:40,dockWidth:100,accentColor:'#30D158',hideOnFullscreen:true,runningIndicators:true},items:[{type:'separator',id:'imported-group'}]};
    await js('importConfig()');
    assert.deepEqual(await js('[settings.iconSize,settings.dockWidth,settings.accentColor,settings.runningIndicators,settings.hideOnFullscreen]'),[40,100,'#30D158',true,true]);
    assert.equal(fullscreen.at(-1),true); assert.equal(await js('items.filter(item=>item.type==="separator").length'),2);
    await js('launcher.open()');
    // Since 0.12.10 the fixture's ten entries are split into six apps and four shortcuts.
    assert.equal(await js('document.querySelectorAll(".app-cell").length'),6);
    await js('document.querySelector("[data-kind=shortcuts]").click()');
    assert.equal(await js('document.querySelectorAll(".app-cell").length'),4);
    await js('document.querySelector("[data-kind=apps]").click()');
    await js('document.querySelector("[data-filter=pinned]").click()');
    assert.equal(await js('document.querySelectorAll(".app-cell").length'),3);
    assert.equal(await js('runningTimer===null'),true);
    const pausedCount=requests.length; await js('refreshRunningIndicators(true)'); assert.equal(requests.length,pausedCount);
    await js('launcher.close()'); await until('!runningPending'); assert.equal(await js('runningTimer!==null'),true);
    await js('settings.systemInfo=true;settings.lyricsBar=true;settings.lyricsText="one\\ntwo";syncSystemInfoTimers();renderLyrics()');
    assert.equal(await js('timeTimer!==null&&batteryTimer!==null&&lyricsTimer!==null'),true);
    win.webContents.send('dock:visibility',false); await pause(); assert.equal(await js('runningTimer===null&&timeTimer===null&&batteryTimer===null&&lyricsTimer===null'),true);
    const hiddenCount=requests.length; await js('refreshRunningIndicators(true)'); assert.equal(requests.length,hiddenCount);
    win.webContents.send('dock:visibility',true); await pause(); await until('!runningPending');
    assert.equal(await js('timeTimer!==null&&batteryTimer!==null&&lyricsTimer!==null'),true);
    await js('settings.systemInfo=false;settings.lyricsBar=false;syncSystemInfoTimers();renderLyrics()');
    failRunning=true; await js('refreshRunningIndicators()'); assert.equal(await js('document.querySelectorAll(".is-running").length'),0);
    failRunning=false; await js('refreshRunningIndicators()'); assert.equal(await js('document.querySelectorAll(".is-running").length'),1);
    const start=requests.length; await js('openItem("alpha")'); await pause(1800);
    assert.ok(requests.slice(start).some(r=>r.refresh===true),'launch schedules fresh snapshot');
    assert.ok(requests.every(r=>r.targets.every(t=>typeof t==='string'&&t.length>0)));
    assert.ok(icons.every(t=>typeof t==='string'&&t.length>0));
    assert.equal(await js('recentItems.every(item=>item.type!=="separator"&&item.target)'),true);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {enabled:true});
    app.focus({steal:true}); win.focus();
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    for(const size of [40,64,72]) {
      await js('settings.iconSize='+size+';applyDockPreferences();dockMotion.refresh()'); await pause();
      await js('closeSettings()'); await pause();
      assert.equal(win.getBounds().height,Math.round(188+(size-64)*1.7));
      for(const width of [600,912]) {
        win.setBounds({width}); await pause(300);
        const count=await js('document.querySelectorAll(".dock-icon").length');
        for(const index of [0,Math.floor(count/2),count-1]) {
          await js('document.activeElement.blur();dockRow.scrollLeft='+(index===count-1?'100000':'0')+';document.querySelectorAll(".dock-icon")['+index+'].focus({preventScroll:true})');
          await pause(800);
          const b=await js('(function(){const r=document.activeElement.querySelector("img").getBoundingClientRect(),c=dockRow.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,clipLeft:c.left,clipRight:c.right,scrollable:dockRow.classList.contains("is-scrollable")};})()');
          assert.ok(b.left>=-.5&&b.right<=b.width+.5&&b.top>=0&&b.bottom<=b.height,JSON.stringify({size,width,index,b}));
          if(b.scrollable) assert.ok(b.left>=b.clipLeft-.5&&b.right<=b.clipRight+.5,JSON.stringify({size,width,index,b}));
          assert.equal(await js('getComputedStyle(document.querySelector(".is-running"),"::after").width'),'5px');
          assert.equal(await js('Number(document.querySelector(".dock-separator").style.getPropertyValue("--dock-scale"))'),1);
        }
      }
      await js('document.activeElement.blur();dockMotion.reset()'); await pause(300);
      fs.writeFileSync(path.join(__dirname,'../docs/dock-size-'+size+'.png'),(await win.capturePage()).toPNG());
    }
    await js('openSettings();renderManageList();document.querySelector("#manageList .manage-item .remove-item").click()');
    assert.equal(await js('items[0].id'),'alpha'); await reload(); assert.equal(await js('items[0].id'),'alpha');
    const backup=await js('JSON.stringify(items)');
    await js('commitItems([...items,...Array.from({length:500-items.length},(_,i)=>({id:"capacity-"+i,type:"separator",name:"分隔线"}))])');
    assert.equal(await js('addDroppedTargets(["C:/Overflow.exe"])'),0); assert.equal(await js('items.length'),500);
    pending=[{id:'capacity-receipt',name:'Overflow',source:'C:/Desktop/Overflow.lnk',target:'C:/Shortcuts/Overflow.lnk'}];
    await js('receiveDesktopImports()'); assert.equal(acknowledgements.length,0); assert.equal(await js('items.length'),500);
    pending=[]; await js('commitItems('+backup+');renderDock()'); await reload(); assert.equal(await js('items.length'),JSON.parse(backup).length);
    console.log('Feature UI passed: persistence, import/reset, separator sort/remove/exclusions, running dots/pause/failure/retry, delayed launch refresh, all icon sizes at narrow/wide bounds, capacity rollback without deleting desktop shortcuts');
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
