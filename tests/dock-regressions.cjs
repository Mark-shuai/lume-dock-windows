const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'lume-regressions-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1100, height: 188, show: false, transparent: true, backgroundColor: '#00000000', frame: false, hasShadow: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const js = source => win.webContents.executeJavaScript(source);
  const pause = (ms = 600) => new Promise(resolve => setTimeout(resolve, ms));
  try {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
    win.webContents.on('console-message', e => { if(e.level==='error') console.error('Renderer:',e.message); });
    await js('window.dockReady');
    win.show(); app.focus({steal:true}); win.focus();
    assert.equal(await js('document.querySelector("#dropHint").hidden'), true, 'Drop hint starts hidden');
    const enter = '(() => { const data = new DataTransfer(); data.items.add(new File(["x"], "test.lnk")); document.querySelector(".dock-shell").dispatchEvent(new DragEvent("dragenter", {bubbles:true, dataTransfer:data})); })()';
    for (const cancel of ['window.dispatchEvent(new Event("blur"))', 'window.dispatchEvent(new Event("dragend"))', 'document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}))', 'document.querySelector(".dock-shell").dispatchEvent(new DragEvent("dragleave", {bubbles:true}))', 'document.querySelector(".dock-shell").dispatchEvent(new DragEvent("drop", {bubbles:true}))']) {
      await js(enter);
      assert.equal(await js('document.querySelector("#dropHint").hidden'), false);
      await js(cancel);
      assert.equal(await js('document.querySelector("#dropHint").hidden'), true, cancel);
    }
    await js('document.body.classList.remove("browser-preview")');
    assert.equal(await js('getComputedStyle(document.querySelector("#settingsPanel")).visibility'), 'hidden');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {enabled:true});
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion', value:'no-preference'}]});
    for (const width of [1100, 912, 720, 600]) {
      win.setBounds({width, height:188});
      await pause();
      const count = await js('document.querySelectorAll(".dock-item").length');
      for (const index of [0, Math.floor(count/2), count-1]) {
        await js('document.activeElement.blur(); document.querySelector("#dockRow").scrollLeft = ' + (index === count-1 ? '100000' : '0'));
        await pause();
        await js('document.querySelectorAll(".dock-icon")[' + index + '].focus({preventScroll:true})');
        await pause();
        const bounds = await js('(() => { const row=document.querySelector("#dockRow"); const img=document.querySelectorAll(".dock-icon img")[' + index + ']; const r=img.getBoundingClientRect(); const clip=row.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollable:row.classList.contains("is-scrollable"),clipLeft:clip.left,clipRight:clip.right}; })()');
        assert.ok(bounds.left >= -0.5 && bounds.right <= bounds.width + .5 && bounds.top >= 0 && bounds.bottom <= bounds.height, JSON.stringify({width,index,bounds}));
        if (bounds.scrollable) assert.ok(bounds.left >= bounds.clipLeft-.5 && bounds.right <= bounds.clipRight+.5, 'Scrollable edge clips icon: '+JSON.stringify({width,index,bounds}));
      }
    }
    win.setBounds({width:1100,height:188});
    await js('document.activeElement.blur(); dockMotion.reset()');
    await pause();
    const bitmap = (await win.capturePage()).toBitmap();
    assert.equal(bitmap[3], 0, 'Native top-left corner must be transparent');
    fs.writeFileSync(path.join(__dirname, '../docs/dock-transparent-regression.png'), (await win.capturePage()).toPNG());
    await js('for (let i=0;i<25;i++) items.push({id:"regression-"+i,name:"App "+i,target:"preview-extra-"+i}); renderDock()');
    await pause();
    assert.ok(await js('document.querySelector("#dockRow").classList.contains("is-scrollable")'));
    for (const edge of ['first', 'last']) {
      await js('document.activeElement.blur(); document.querySelector("#dockRow").scrollLeft = ' + (edge === 'last' ? '100000' : '0'));
      await pause();
      await js('(document.querySelectorAll(".dock-icon")[' + (edge === 'last' ? 'document.querySelectorAll(".dock-icon").length-1' : '0') + ']).focus({preventScroll:true})');
      await pause();
      const b = await js('(() => { const img=document.activeElement.querySelector("img").getBoundingClientRect(); const row=document.querySelector("#dockRow").getBoundingClientRect(); return {left:img.left,right:img.right,top:img.top,bottom:img.bottom,clipLeft:row.left,clipRight:row.right}; })()');
      assert.ok(b.left >= b.clipLeft-.5 && b.right <= b.clipRight+.5 && b.top >= 16 && b.bottom <= 180, 'Many-app edge clipped: '+JSON.stringify({edge,b}));
    }
    console.log('Dock regressions passed: hidden hint, five drag cancellation paths, hidden settings, actual icon bounds at four widths, transparent corner, many-app scroll edges');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
