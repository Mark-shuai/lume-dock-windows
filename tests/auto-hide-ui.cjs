const { app, BrowserWindow, screen }=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'lume-auto-hide-')));
let pointer={x:-100000,y:-100000};
// Replay screen-point trajectories through the actual main-process polling loop.
// Native cursor speed/Windows compositor behavior still needs Windows validation.
require('../main');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
setTimeout(()=>{console.error('Auto-hide UI timed out');app.exit(1);},35000).unref();
app.whenReady().then(async()=>{
 screen.getCursorScreenPoint=()=>pointer;
 const dock=BrowserWindow.getAllWindows()[0],js=source=>dock.webContents.executeJavaScript(source);
 const changes=[];dock.on('show',()=>changes.push('show'));dock.on('hide',()=>changes.push('hide'));
 async function until(test){for(let n=0;n<100;n++){if(await test())return;await pause(30);}throw Error('Auto-hide condition timed out');}
 try{
  if(dock.webContents.isLoading())await new Promise(resolve=>dock.webContents.once('did-finish-load',resolve));
  await js('window.dockReady');
  await js('settings.hideOnFullscreen=false;window.dockAPI.setFullscreenHide(false)');
  await js('settings.autoHide=true;save();window.dockAPI.setAutoHide(true)');
  await until(()=>!dock.isVisible());await until(()=>changes.at(-1)==='hide');
  const {workArea, bounds:display}=screen.getPrimaryDisplay(),bottom=workArea.y+workArea.height;
  const bounds=dock.getBounds(),x=bounds.x+bounds.width/2;
  changes.length=0;
  pointer={x,y:bottom-1};await until(()=>dock.isVisible());
  pointer={x,y:bottom-6};await pause(1400);
  assert.equal(dock.isVisible(),true,'gap does not trigger another native hide');
  pointer={x,y:display.y+display.height-1};await pause(300);
  pointer={x,y:bounds.y+Math.floor(bounds.height/2)};await pause(300);
  assert.deepEqual(changes,['show'],'fast approach performs exactly one native show');
  pointer={x:-100000,y:-100000};await until(()=>!dock.isVisible());await until(()=>changes.at(-1)==='hide');
  assert.deepEqual(changes,['show','hide']);
  // A slow approach remains equivalent and normal leave-to-hide still works.
  changes.length=0;
  pointer={x,y:bounds.y+20};await pause(200);assert.equal(dock.isVisible(),false);
  pointer={x,y:bottom-1};await until(()=>dock.isVisible());
  pointer={x,y:bottom-6};await pause(300);
  pointer={x,y:bounds.y+bounds.height-20};await pause(1000);
  assert.deepEqual(changes,['show']);
  pointer={x:-100000,y:-100000};await until(()=>!dock.isVisible());await until(()=>changes.at(-1)==='hide');
  await js('window.dockAPI.setAutoHide(false)');assert.equal(dock.isVisible(),true);
  // Independent settings keep the native Dock visible while previewing.
  await js('window.dockAPI.setAutoHide(true);window.dockAPI.openSettings()');
  await pause(1100);assert.equal(dock.isVisible(),true);
  await js('window.dockAPI.closeSettings()');await until(()=>!dock.isVisible());await until(()=>changes.at(-1)==='hide');
  await js('window.dockAPI.setAutoHide(false)');
  console.log('Auto-hide Electron passed: actual native visibility transitions, fast gap/physical-edge path shows once, slow path, normal leave, disable reveals, floating settings suspension/restoration. Screen points are simulated.');app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
