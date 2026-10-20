const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createIconService } = require('../icon-service');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-stability-'));
app.setPath('userData', userData);
require('../main');
const catalog = Array.from({ length: 1000 }, (_, i) => ({ id: `stress-${i}`, name: `Test App ${String(i).padStart(4, '0')}`, target: `C:\\Tools\\App-${i}.exe`, source: '模拟应用' }));
const png = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, '../renderer/assets/macos/generic.png')).toString('base64')}`;
let iconReads = 0;
let configData = {};
const iconService = createIconService({ load: async () => {
  iconReads++;
  await new Promise(resolve => setTimeout(resolve, 12));
  return png;
} });
for (const name of ['list-apps', 'scan-desktop', 'get-icon', 'config:import']) ipcMain.removeHandler(name);
ipcMain.handle('list-apps', async () => {
  await new Promise(resolve => setTimeout(resolve, 12));
  return { items: catalog, warnings: [] };
});
ipcMain.handle('scan-desktop', () => ({ items: [] }));
ipcMain.handle('get-icon', (_event, target) => iconService.get(target));
ipcMain.handle('config:import', () => ({ ok: true, data: configData }));

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const js = source => win.webContents.executeJavaScript(source);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const errors = [];
  const visibilityEvents = [];
  for (const event of ['show','hide','ready-to-show']) win.on(event, () => visibilityEvents.push({event,time:Date.now(),visible:win.isVisible(),loading:win.webContents.isLoading()}));
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  async function heap() {
    await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
    return (await win.webContents.debugger.sendCommand('Runtime.getHeapUsage')).usedSize;
  }
  async function cycle() {
    await js(`(async () => {
      await launcher.open();
      const search = document.querySelector('#appSearch');
      for (const value of ['Test App 00', 'unmatched', '']) {
        search.value = value;
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      launcher.close();
    })()`);
  }
  try {
    if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await js('window.dockReady');
    assert.equal(await js('timeTimer === null && batteryTimer === null'), true, 'disabled system info has no timers');
    // Real renderer validates malformed imports without crashing the launcher.
    configData = {
      items: [{ id: '\" onclick=\"throw 1', name: 'Safe entry', target: 'C:\\Safe.exe' }, { name: 'duplicate', target: 'c:/safe.exe' }],
      settings: { glassBlur: 0, glassHighlight: 0, glassShadow: 0, lyricsText: '第一行\n第二行', lyricsTitle: {}, theme: 'invalid' },
      recentItems: [null, { target: 'C:\\NoName.exe' }, { target: 'javascript:alert(1)' }],
    };
    await js('importConfig()');
    assert.equal(await js('items.filter(item => targetKey(item.target) === targetKey("C:\\\\Safe.exe")).length'), 1);
    assert.equal(await js('recentItems[0].name'), 'NoName');
    assert.equal(await js('dockShell.style.getPropertyValue("--dock-blur")'), '0px');
    assert.equal(await js('dockShell.style.getPropertyValue("--dock-shadow-opacity")'), '0');
    assert.equal(await js('lyricsLines().length'), 2);
    const failedSave = await js(`(() => {
      const before = items.length;
      const original = Storage.prototype.setItem;
      const originalSettings = { ...settings };
      // Edit a setting as well so this remains a two-key rollback test.
      settings.glassRadius = settings.glassRadius === 22 ? 23 : 22;
      let failOnce = true;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'lume-dock-settings-v1' && failOnce) { failOnce = false; throw new Error('Quota exceeded'); }
        return original.call(this, key, value);
      };
      let added;
      try { added = addDroppedTargets(['C:\\\\Unsaved.exe']); }
      finally { Storage.prototype.setItem = original; settings = originalSettings; }
      return { added, count: items.length, saved: JSON.parse(localStorage.getItem('lume-dock-items-v1')).length, before };
    })()`);
    assert.equal(failedSave.added, 0);
    assert.equal(failedSave.count, failedSave.before);
    assert.equal(failedSave.saved, failedSave.before, 'partially written config rolls back');
    await js('launcher.open()');
    assert.ok(await js('document.querySelectorAll(".app-cell").length <= 120'), 'large catalogs only mount visible rows');
    assert.match(await js('document.querySelector("#launcherStatus").textContent'), /1005/, JSON.stringify(await js('({search: document.querySelector("#appSearch").value, open: launcher.isOpen(), pinned: items.length})')));
    await js('document.querySelector("#appGrid").scrollTop = document.querySelector("#appGrid").scrollHeight');
    // Wait for the animation-frame render rather than assuming an idle host.
    let reachedLast = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      reachedLast = await js('[...document.querySelectorAll(".app-name")].some(node => node.textContent === "Test App 0999")');
      if (reachedLast) break;
      await pause(50);
    }
    assert.ok(reachedLast, 'virtual scrolling reaches the last app');
    await js('document.querySelector("#appGrid").scrollTop = 0');
    await pause(120);
    await js(`(() => {
      const cells = [...document.querySelectorAll('.app-cell')];
      const button = cells.at(-1).querySelector('.app-open');
      window.lastVirtualIndex = Number(cells.at(-1).dataset.index);
      button.focus();
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    })()`);
    assert.ok(await js('Number(document.activeElement.closest(".app-cell").dataset.index) > window.lastVirtualIndex'), 'arrow navigation crosses virtual row boundaries');
    await js('document.querySelector("#appSearch").focus(); document.querySelector("#appGrid").scrollTop = 0');
    await pause(120);
    // Rerender while icons are in flight; fresh nodes still receive their icon.
    await js('[...document.querySelectorAll(".app-cell")].find(node => node.querySelector(".app-name").textContent === "Test App 0000").scrollIntoView({block:"center"})');
    await pause(20);
    await js('launcher.render(); launcher.render()');
    await pause(250);
    const iconLoaded = await js('[...document.querySelectorAll(".app-cell")].find(node => node.querySelector(".app-name").textContent === "Test App 0000").querySelector(".app-art img").src.startsWith("data:image/png;base64,")');
    assert.ok(iconLoaded, JSON.stringify({ iconReads, layout: await js('({hidden: document.hidden, bounds: document.querySelector("#appGrid").getBoundingClientRect().toJSON(), scroll: document.querySelector("#appGrid").scrollTop})') }));
    await js('launcher.close()');
    await pause(100);
    const readsAfterClose = iconReads;
    await pause(100);
    assert.equal(iconReads, readsAfterClose, 'hidden launcher stops queued icon work');
    assert.equal(await js('document.querySelectorAll(".app-cell").length'), 0);
    await js('(async () => { const pending = launcher.refresh(); launcher.close(); await pending; })()');
    assert.equal(await js('document.querySelectorAll(".app-cell").length'), 0, 'late catalog response cannot rebuild hidden DOM');
    // Visibility changes must stop clocks, battery polling and lyric playback.
    await js('settings.systemInfo = true; settings.lyricsBar = true; syncSystemInfoTimers(); renderLyrics()');
    assert.equal(await js('timeTimer !== null && batteryTimer !== null'), true);
    win.hide();
    // Explicit main-process notification is authoritative even if macOS omits hide events.
    win.webContents.send('dock:visibility', false);
    await pause(100);
    assert.equal(await js('!nativeVisible && timeTimer === null && batteryTimer === null && lyricsTimer === null'), true, JSON.stringify({visible:win.isVisible(), visibilityEvents, renderer:await js('({hidden:document.hidden,nativeVisible,timeStopped:timeTimer===null,batteryStopped:batteryTimer===null})')}));
    win.showInactive();
    win.webContents.send('dock:visibility', true);
    await pause(100);
    await js('settings.systemInfo = false; settings.lyricsBar = false; syncSystemInfoTimers(); renderLyrics()');
    for (let i = 0; i < 5; i++) await cycle();
    await pause(250);
    win.webContents.debugger.attach('1.3');
    const before = await heap();
    const rssBefore = app.getAppMetrics().map(({ type, memory }) => ({ type, memory }));
    const start = Date.now();
    for (let i = 0; i < 40; i++) await cycle();
    await pause(250);
    const after = await heap();
    const report = {
      date: new Date().toISOString(), appVersion: require('../package.json').version, platform: process.platform, arch: process.arch,
      electron: process.versions.electron, simulatedApps: catalog.length, measuredCycles: 40,
      durationMs: Date.now() - start, rendererHeapBeforeBytes: before, rendererHeapAfterBytes: after,
      rendererHeapGrowthBytes: after - before, nativeIconReads: iconReads,
      processMemoryBefore: rssBefore, processMemoryAfter: app.getAppMetrics().map(({ type, memory }) => ({ type, memory })),
      limitations: 'Synthetic short-run test on the reported host. Working sets include shared memory; these are not Windows idle-memory or long-run leak measurements.',
    };
    win.webContents.debugger.detach();
    fs.mkdirSync(path.join(__dirname, '../docs'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '../docs/stability-report.json'), JSON.stringify(report, null, 2));
    assert.ok(after - before < 8 * 1024 * 1024, `renderer heap grew by ${after - before} bytes`);
    assert.equal(await js('document.querySelectorAll(".app-cell").length'), 0);
    assert.deepEqual(errors, []);
    // Damaged persisted data must recover after a complete renderer reload.
    await js(`localStorage.setItem('${'lume-dock-items-v1'}', '{}'); localStorage.setItem('lume-dock-recent-v1', '{}'); localStorage.setItem('lume-dock-settings-v1', '[]'); localStorage.setItem('lume-dock-dismissed-v1', '{}')`);
    const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.reload(); await loaded; await js('window.dockReady');
    assert.equal(await js('items.length'), 7);
    await js('launcher.open()'); await js('launcher.close()');
    console.log(`Stability UI passed: 1000 apps, malformed imports, zero effects, hidden-work cleanup and 40 cycles. GC heap ${(before / 1048576).toFixed(2)} -> ${(after / 1048576).toFixed(2)} MiB.`);
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
