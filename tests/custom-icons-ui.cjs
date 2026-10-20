const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { readCustomIcon } = require('../custom-icon-image');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-custom-icons-'));
app.setPath('userData', path.join(temporary, 'profile'));
let selection;
let pickerCount = 0;
setTimeout(() => { console.error('Custom icons test timed out'); app.exit(1); }, 45000).unref();
const configFile = path.join(temporary, 'config.json');
dialog.showOpenDialog = async () => { pickerCount++; return selection ? { canceled: false, filePaths: [selection] } : { canceled: true, filePaths: [] }; };
dialog.showSaveDialog = async () => ({ canceled: false, filePath: configFile });
require('../main');
let artwork;
const records = [
  { id: 'native-a', name: '别名应用', target: 'apps-folder:Vendor.A', source: '已安装应用' },
  { id: 'native-b', name: '未固定应用', target: 'apps-folder:Vendor.B', source: '已安装应用' },
];
ipcMain.removeHandler('list-apps');
ipcMain.handle('list-apps', () => ({ items: records.map(item => ({ ...item, icon: artwork })), identities: [
  { source: 'C:/Desktop/A.lnk', identity: ['app:a'] }, { source: records[0].target, identity: ['app:a'] },
] }));
ipcMain.removeHandler('scan-desktop'); ipcMain.handle('scan-desktop', () => ({ items: [] }));
ipcMain.removeHandler('get-icon'); ipcMain.handle('get-icon', async () => { await new Promise(resolve => setTimeout(resolve, 160)); return artwork; });
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const errors = [];
  const js = source => win.webContents.executeJavaScript(source).catch(error => { throw new Error(source.slice(0,180) + ': ' + error.message); });
  const pause = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
  const until = async predicate => { for (let i=0;i<100;i++) { if (await predicate()) return; await pause(40); } throw new Error('Timed out waiting for UI'); };
  const search = async text => { await js(`appSearch.value=${JSON.stringify(text)}; appSearch.dispatchEvent(new Event('input'))`); };
  let settingsWin;
  try {
    if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await js('window.dockReady');
    const bitmap = Buffer.alloc(512 * 256 * 4);
    for (let y=0;y<256;y++) for (let x=0;x<512;x++) {
      const i=(y*512+x)*4; if (x<8 || x>503 || y<8 || y>247) continue;
      bitmap[i]=190; bitmap[i+1]=90; bitmap[i+2]=225; bitmap[i+3]=255;
    }
    const fixture = nativeImage.createFromBitmap(bitmap,{width:512,height:256});
    const pngFile = path.join(temporary,'透明 中文 & 图标.png');
    const jpgFile = path.join(temporary,'landscape.jpg');
    fs.writeFileSync(pngFile, fixture.toPNG()); fs.writeFileSync(jpgFile, fixture.toJPEG(88));
    artwork = nativeImage.createFromPath(path.join(__dirname,'../renderer/assets/macos/calculator.png')).toDataURL();
    const png = await readCustomIcon(pngFile,nativeImage);
    const jpg = await readCustomIcon(jpgFile,nativeImage);
    assert.deepEqual(nativeImage.createFromDataURL(png).getSize(), {width:128,height:64});
    assert.equal(nativeImage.createFromDataURL(png).toBitmap()[3],0,'Transparent corners survive import');
    assert.ok(jpg.length <= 48*1024);
    const ico = Buffer.alloc(22 + fixture.toPNG().length);
    ico.writeUInt16LE(1,2); ico.writeUInt16LE(1,4); ico.writeUInt16LE(32,12); ico.writeUInt32LE(ico.length-22,14); ico.writeUInt32LE(22,18); fixture.toPNG().copy(ico,22);
    const icoFile=path.join(temporary,'png.ico'); fs.writeFileSync(icoFile,ico);
    assert.equal(await readCustomIcon(icoFile,nativeImage),png,'PNG-backed ICO decodes');
    const classic=Buffer.alloc(22+40+16*48+16*4);
    classic.writeUInt16LE(1,2); classic.writeUInt16LE(1,4); classic[6]=classic[7]=16; classic.writeUInt16LE(1,10); classic.writeUInt16LE(24,12);
    classic.writeUInt32LE(classic.length-22,14); classic.writeUInt32LE(22,18); classic.writeUInt32LE(40,22); classic.writeInt32LE(16,26); classic.writeInt32LE(32,30); classic.writeUInt16LE(1,34); classic.writeUInt16LE(24,36);
    for(let y=0;y<16;y++) for(let x=0;x<16;x++) if(x<4||x>=12||y<4||y>=12) classic[22+40+768+y*4+(x>>3)]|=0x80>>(x%8);
    const classicFile=path.join(temporary,'classic.ico');fs.writeFileSync(classicFile,classic);
    const pixels=nativeImage.createFromDataURL(await readCustomIcon(classicFile,nativeImage)).toBitmap();
    assert.equal(pixels[3],0);assert.deepEqual([...pixels.subarray((8*16+8)*4,(8*16+8)*4+4)],[0,0,0,255],'ICO mask preserves opaque black');
    const badFile=path.join(temporary,'bad.png');fs.writeFileSync(badFile,'not an image');
    await assert.rejects(readCustomIcon(badFile,nativeImage),/格式无效/);
    const largeFile=path.join(temporary,'large.png');fs.writeFileSync(largeFile,Buffer.alloc(8*1024*1024+1));
    await assert.rejects(readCustomIcon(largeFile,nativeImage),/8 MB/);
    const dimensionsFile=path.join(temporary,'dimensions.png'),header=Buffer.from(fixture.toPNG());header.writeUInt32BE(50000,16);fs.writeFileSync(dimensionsFile,header);
    await assert.rejects(readCustomIcon(dimensionsFile,nativeImage),/4096/);
    await js(`items=[{id:'shortcut-a',name:'桌面别名',target:'C:/Desktop/A.lnk',icon:${JSON.stringify(artwork)},iconVersion:2}];save();renderDock();launcher.open()`);
    await search('未固定应用');
    await js(`document.querySelector('.app-edit-icon').click()`);
    await until(()=>js('iconDialog.open'));
    assert.equal(await js('items.length'),1,'Editing an unpinned app does not pin it');
    selection=null;
    await js('chooseCustomIcon.click()');await until(()=>js('!chooseCustomIcon.disabled'));
    assert.equal(await js('customIconStore.export().length'),0,'Cancel retains original');
    selection=badFile;
    await js('chooseCustomIcon.click()');await until(()=>js('!chooseCustomIcon.disabled'));
    assert.match(await js('customIconError.textContent'),/格式无效/);
    selection=pngFile;
    await js('chooseCustomIcon.click()');await until(()=>js('!chooseCustomIcon.disabled'));
    assert.equal(await js('customIconPreview.src'),png);
    await pause(250);fs.writeFileSync(path.join(__dirname,'../docs/custom-icon-editor-0.12.9.png'),(await win.capturePage()).toPNG());
    assert.equal(await js(`document.querySelector('.app-art img').src`),png);
    assert.equal(await js('items.length'),1);
    fs.renameSync(pngFile,pngFile+'.moved');
    await js(`closeIconDialog.click();document.querySelector('.app-pin').click()`);
    assert.equal(await js(`document.querySelector('[data-id^="pinned-"] img').src`),png);
    await js('launcher.refresh()');
    assert.equal(await js(`document.querySelector('.app-art img').src`),png,'Catalog refresh keeps custom image');
    await search('别名应用');
    await js(`document.querySelector('.app-open').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
    await until(()=>js('iconDialog.open'));selection=jpgFile;
    await js('chooseCustomIcon.click()');await until(()=>js('!chooseCustomIcon.disabled'));
    await pause(250);
    assert.equal(await js(`document.querySelector('[data-id="shortcut-a"] img').src`),jpg,'Merged alias changes the existing Dock shortcut');
    await js('closeIconDialog.click();exportConfig()');
    const exported=JSON.parse(fs.readFileSync(configFile,'utf8'));
    assert.equal(exported.customIcons.length,2);assert.ok(exported.customIcons.every(record=>record.icon.startsWith('data:image/png;base64,')));
    await js(`document.documentElement.dataset.theme='dark'`);await pause(300);
    fs.writeFileSync(path.join(__dirname,'../docs/launcher-0.12.9-dark.png'),(await win.capturePage()).toPNG());
    for (const theme of ['dark','light']) {
      await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      const colors=await js(`(()=>{const c=getComputedStyle(launcherPanel);return {background:c.backgroundImage,ink:c.getPropertyValue('--ink'),muted:c.getPropertyValue('--muted')}})()`);
      assert.ok(colors.background.includes(theme==='dark'?'102, 103, 107':'228, 229, 232'));
      assert.equal(await js(`getComputedStyle(document.querySelector('.launcher-header')).marginBottom`),'12px');
    }
    await pause(300);fs.writeFileSync(path.join(__dirname,'../docs/launcher-0.12.9-light.png'),(await win.capturePage()).toPNG());
    await js('launcher.close();openSettings()');
    await until(()=>Promise.resolve(BrowserWindow.getAllWindows().length===2));settingsWin=BrowserWindow.getAllWindows().find(window=>window!==win);
    const sj=source=>settingsWin.webContents.executeJavaScript(source);
    if(settingsWin.webContents.isLoading()) await new Promise(resolve=>settingsWin.webContents.once('did-finish-load',resolve));
    await sj('window.dockReady');
    await until(()=>sj(`!!document.querySelector('[data-id="shortcut-a"] .change-icon')`));
    await sj(`document.querySelector('[data-id="shortcut-a"] .change-icon').click()`);
    await until(()=>sj('iconDialog.open'));
    assert.equal(await sj('customIconPreview.src'),jpg);
    const bounds=settingsWin.getBounds();
    await sj('resetCustomIcon.click()');
    await until(()=>js(`document.querySelector('[data-id="shortcut-a"] img').src===${JSON.stringify(artwork)}`));
    assert.deepEqual(settingsWin.getBounds(),bounds,'Icon editor does not resize settings');
    await sj('closeIconDialog.click()');settingsWin.close();
    // Reload proves the image does not depend on the original file location.
    await win.webContents.reload();await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));await js('window.dockReady');
    assert.equal(await js(`document.querySelector('[data-id^="pinned-"] img').src`),png);
    selection=configFile;await js('importConfig()');
    assert.equal(await js(`customIconStore.get({target:'C:/Desktop/A.lnk'})`),jpg,'Export/import restores alias artwork');
    // A quota failure after icon import rolls back both the icon map and pins.
    exported.settings.iconSize=72;fs.writeFileSync(configFile,JSON.stringify(exported));
    await js(`customIconStore.set({target:'C:/Desktop/A.lnk'},null);window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='lume-dock-settings-v1')throw Error('quota');return originalSet.call(this,key,value)};settings.iconSize=40`);
    await js('importConfig()');
    assert.equal(await js(`customIconStore.get({target:'C:/Desktop/A.lnk'})`),null);
    await js('Storage.prototype.setItem=originalSet;void 0');
    await js(`document.querySelector('[data-id="shortcut-a"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));document.querySelector('[data-id="shortcut-a"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));void 0`);
    await until(()=>js('iconDialog.open'));
    assert.ok(win.getBounds().height>=300,'Dock editor expands to a usable height');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await until(()=>js('!iconDialog.open'));
    await until(()=>Promise.resolve(win.getBounds().height<300));
    // The panel stays usable at small work-area sizes, including touch actions.
    await js('launcher.open()');win.setBounds({width:440,height:540});await search('');await pause(300);
    assert.equal(await js('innerWidth'),440,'Narrow layout uses the actual renderer viewport');
    assert.equal(await js(`launcherPanel.scrollWidth<=launcherPanel.clientWidth`),true);
    assert.equal(await js(`document.querySelector('.launcher-toolbar').scrollWidth<=document.querySelector('.launcher-toolbar').clientWidth`),true);
    fs.writeFileSync(path.join(__dirname,'../docs/launcher-0.12.9-narrow.png'),(await win.capturePage()).toPNG());
    assert.equal(errors.length,0,errors.join('\n'));
    assert.ok(pickerCount>=5);
    console.log('Custom icon UI passed: raster/ICO decoding, alpha, limits, cancel/error, unpinned/pinned aliases, refresh, two-window reset, restart without source file, export/import/rollback, themes and narrow layout');
    app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
});
