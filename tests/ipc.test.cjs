const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

function entry(name, directory = false) {
  return { name, isFile: () => !directory, isSymbolicLink: () => false };
}

function harness({ spawnError = false, readDesktop, selection, pickerError, confirmation = true, argv = [], ownsInstance = true, importService, catalogService, identityService, appIconReader } = {}) {
  const handlers = {};
  const calls = [];
  const events = {};
  const intervals = new Set();
  let tick;
  let cursor = { x: -1, y: -1 };
  let now = 0;
  let window;
  let fullscreenState;
  let trayOptions;
  const processRequests = [];
  const processService = { get: async (...args) => { processRequests.push(args); return { targets: args[0] }; }, invalidate: () => calls.push(['invalidate']), clear() {} };
  const area = { x: 100, y: 50, width: 1920, height: 1040 };
  class Window {
    constructor(bounds) { this.bounds = bounds; this.visible = true; this.visibilityChanges = []; this.webContents = { isLoading: () => false, send: (...args) => calls.push(['send', ...args]) }; window = this; }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    loadFile() {}
    once() {}
    isDestroyed() { return this.destroyed === true; }
    destroy() { this.destroyed = true; this.visible = false; }
    getBounds() { return this.bounds; }
    setBounds(bounds) { this.bounds = bounds; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; this.visibilityChanges.push(true); }
    hide() { this.visible = false; this.visibilityChanges.push(false); }
  }
  const electron = {
    app: {
      requestSingleInstanceLock: () => ownsInstance, isPackaged: true,
      whenReady: () => ({ then: (fn) => fn() }), on: (name, fn) => { events[name] = fn; }, quit: () => calls.push(['quit']),
      exit: code => calls.push(['exit',code]),
      getPath: (key) => `C:\\Users\\Demo\\${key}`,
      setLoginItemSettings() {}, getLoginItemSettings: () => ({ openAtLogin: true }),
    },
    BrowserWindow: Window,
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    screen: {
      getPrimaryDisplay: () => ({ workArea: area, bounds: { ...area, height: 1080 } }),
      getCursorScreenPoint: () => cursor, on() {},
    },
    shell: {
      openExternal: async (target) => { calls.push(['external', target]); },
      openPath: async (target) => { calls.push(['path', target]); return ''; },
    },
    dialog: { showMessageBox: async (_win, options) => { calls.push(['message', options]); return { response: confirmation ? 1 : 0 }; }, showOpenDialog: async (_win, options) => {
      calls.push(['dialog', options]);
      if (pickerError) throw new Error('picker unavailable');
      return selection || { canceled: true, filePaths: [] };
    } },
  };
  const context = {
    __dirname: path.resolve(__dirname, '..'), process: { argv, execPath: 'C:\\Apps\\Lume Dock.exe', platform: 'win32', env: { PUBLIC: 'C:\\Users\\Public' } },
    setInterval: (fn) => { tick = fn; intervals.add(fn); return fn; }, clearInterval: fn => intervals.delete(fn),
    Date: { now: () => now },
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === './icon-service' || name === './windows-icons') return require(path.join('..',name));
      if (name === './auto-hide') return require('../auto-hide');
      if (name === './helper-processes') return {track:child=>child,stop:()=>{calls.push(['helpers-stop']);return Promise.resolve([]);}};
      if (name === './windows-apps' && catalogService) return { createAppCatalog: () => catalogService };
      if (name === './app-icon-reader' && appIconReader) return { createAppIconReader: () => appIconReader };
      if (name === './app-identities' && identityService) return { createIdentityResolver: () => identityService };
      if (name === path.resolve(__dirname, '../fullscreen-monitor')) return {
        createFullscreenPolicy: require('../fullscreen-monitor').createFullscreenPolicy,
        createFullscreenMonitor: ({ onState }) => { fullscreenState = onState; return { setEnabled: value => { if (!value) onState(false); }, dispose() {} }; },
      };
      if (name === path.resolve(__dirname, '../windows-processes')) return { createProcessService: () => processService };
      if (name === path.resolve(__dirname, '../tray')) return { createTrayController: options => { trayOptions = options; return { refresh() {}, destroy() {} }; } };
      if (name === path.resolve(__dirname, '../windows-integration') && importService) return { cliImport: require('../windows-integration').cliImport, createIntegration: () => importService };
      if (name === 'fs') return { promises: { readdir: readDesktop || (async (directory) => directory.includes('Public') ? [] : [entry('Editor.lnk'), entry('readme.txt')]) } };
      if (name === 'child_process') return { execFile: (target, args, options, callback) => { calls.push(['execFile', target, args]); callback?.(null); }, spawn: (target, args) => {
        calls.push(['spawn', target]);
        calls.push(['args', args]);
        const child = new EventEmitter();
        child.unref = () => {};
        queueMicrotask(() => child.emit(spawnError ? 'error' : 'spawn', new Error('command missing')));
        return child;
      } };
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
  return {
    invoke: (name, ...args) => handlers[name](null, ...args), calls, window, events, processRequests,
    fullscreen: value => fullscreenState(value), reveal: () => trayOptions.onShow(),
    activeTimers: () => intervals.size,
    tick: (point, time) => { cursor = point; now = time; tick(); },
  };
}

test('application list resolves both catalog and local shortcut identities and forwards explicit refresh', async () => {
  const targets = [], refreshes = [];
  const h = harness({ catalogService: { list:async options=>{refreshes.push(options.refresh);return {items:[{name:'App',target:'apps-folder:Vendor.App'}]};} },
    identityService: {get:async (input,refresh)=>{targets.push(...input);assert.equal(refresh,true);return [{source:input[0],identity:['app:vendor.app']}];}} });
  const result = await h.invoke('list-apps',{refresh:true,targets:['C:/Desktop/App.lnk']});
  assert.deepEqual([...targets],['apps-folder:Vendor.App','C:/Desktop/App.lnk']);
  assert.deepEqual(refreshes,[true]);
  assert.equal(result.identities[0].source,'apps-folder:Vendor.App');
});

test('quit is idempotent, destroys the Dock, cancels polling and waits for helper shutdown', async () => {
  const h = harness();
  await h.invoke('dock:set-auto-hide',true);
  assert.equal(h.activeTimers(),1);
  let prevented=0;
  h.events['before-quit']({preventDefault:()=>prevented++});
  h.events['before-quit']({preventDefault:()=>prevented++});
  assert.equal(prevented,2);assert.equal(h.window.isDestroyed(),true);assert.equal(h.activeTimers(),0);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls.filter(call=>call[0]==='helpers-stop').length,1);
  assert.equal(h.calls.filter(call=>call[0]==='exit').length,1);
  await h.invoke('dock:set-auto-hide',true);assert.equal(h.activeTimers(),0);
  const result=await h.invoke('open-target','C:/Apps/App.exe');assert.equal(result.ok,false);
});

test('quit command reaches the owner and a cold quit request creates no window', () => {
  const h=harness();h.events['second-instance'](null,['Lume Dock.exe','--quit']);
  assert.deepEqual(h.calls.at(-1),['quit']);
  const cold=harness({argv:['Lume Dock.exe','--quit']});
  assert.equal(cold.window,undefined);assert.deepEqual(cold.calls,[['quit']]);
});

test('Windows paths stay file paths; URLs and system protocols use the shell', async () => {
  const h = harness();
  for (const target of ['C:\\Tools\\Editor.exe', 'D:/Work/项目']) {
    assert.equal((await h.invoke('open-target', target)).ok, true);
    assert.deepEqual(h.calls.at(-1), ['path', target]);
  }
  for (const target of ['https://example.com', 'ms-calendar:', 'file:///C:/Work']) {
    assert.equal((await h.invoke('open-target', target)).ok, true);
    assert.deepEqual(h.calls.at(-1), ['external', target]);
  }
});

test('recycle bin opens through Explorer and empty action requires confirmation', async () => {
  const h = harness();
  assert.equal((await h.invoke('recycle-bin:open')).ok, true);
  assert.deepEqual(h.calls.at(-2), ['spawn', 'C:\\Windows\\explorer.exe']);
  assert.deepEqual(Array.from(h.calls.at(-1)[1]), ['shell:RecycleBinFolder']);
  const empty = await h.invoke('recycle-bin:empty');
  assert.equal(empty.ok, true);
  assert.equal(h.calls.at(-1)[0], 'execFile');
  const canceled = await harness({ confirmation: false }).invoke('recycle-bin:empty');
  assert.equal(canceled.ok, false);
  assert.equal(canceled.canceled, true);
});

test('PATH commands resolve on spawn and report missing executable errors', async () => {
  const h = harness();
  assert.equal((await h.invoke('open-target', 'wt.exe')).ok, true);
  assert.deepEqual(h.calls.at(-2), ['spawn', 'wt.exe']);
  const failed = await harness({ spawnError: true }).invoke('open-target', 'wt.exe');
  assert.equal(failed.ok, false);
  assert.equal(failed.message, 'command missing');
  assert.equal((await h.invoke('open-target', {})).ok, false);
});

test('packaged applications launch through Explorer with one literal argument', async () => {
  const h = harness();
  const id = 'Microsoft.Calculator_123!App';
  assert.equal((await h.invoke('open-target', `apps-folder:${id}`)).ok, true);
  assert.deepEqual(h.calls[0], ['spawn', 'C:\\Windows\\explorer.exe']);
  assert.deepEqual(Array.from(h.calls[1][1]), [`shell:AppsFolder\\${id}`]);
  assert.equal((await h.invoke('open-target', 'apps-folder:bad\nvalue')).ok, false);
  assert.equal((await h.invoke('open-target', 'apps-folder:')).ok, false);
});

test('desktop scanning returns the items envelope consumed by the renderer', async () => {
  const result = await harness().invoke('scan-desktop');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, 'Editor');
  assert.match(result.items[0].target, /Editor\.lnk$/);
});

test('scanner reads user and public desktops without a 30-entry limit and excludes folders', async () => {
  const roots = [];
  const result = await harness({ readDesktop: async (directory) => {
    roots.push(directory);
    return directory.includes('Public') ? [entry('Shared.url')] : [
      ...Array.from({ length: 45 }, (_, i) => entry(`App-${i}.lnk`)),
      entry('fake.exe', true), entry('notes.txt'),
    ];
  } }).invoke('scan-desktop');
  assert.equal(roots.length, 2);
  assert.equal(result.items.length, 46);
  assert.ok(result.items.some((item) => item.name === 'Shared'));
});

test('inaccessible desktop does not discard results from the other desktop', async () => {
  const result = await harness({ readDesktop: async (directory) => {
    if (directory.includes('Public')) throw Object.assign(new Error('Access denied'), { code: 'EACCES' });
    return [entry('Editor.lnk')];
  } }).invoke('scan-desktop');
  assert.equal(result.items.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.error, undefined);
  const failed = await harness({ readDesktop: async () => { throw new Error('Unavailable'); } }).invoke('scan-desktop');
  assert.equal(failed.items.length, 0);
  assert.ok(failed.error);
});

test('native picker returns a useful name, supports folders, and handles cancellation/errors', async () => {
  const h = harness({ selection: { canceled: false, filePaths: ['C:\\Tools\\编辑器.lnk'] } });
  const file = await h.invoke('pick-target', 'file');
  assert.equal(file.target, 'C:\\Tools\\编辑器.lnk');
  assert.equal(file.name, '编辑器');
  assert.equal(h.calls.at(-1)[1].properties[0], 'openFile');
  const folder = await harness({ selection: { canceled: false, filePaths: ['D:\\Work\\项目.v2'] } }).invoke('pick-target', 'folder');
  assert.equal(folder.name, '项目.v2');
  assert.equal((await harness().invoke('pick-target', 'file')).canceled, true);
  assert.ok((await harness({ pickerError: true }).invoke('pick-target', 'file')).error);
  assert.ok((await h.invoke('pick-target', 'invalid')).error);
});

test('bounds respect work-area origin and auto-hide reveals at the taskbar edge', async () => {
  const h = harness();
  const bounds = h.window.getBounds();
  assert.equal(bounds.y + bounds.height, 1082);
  await h.invoke('dock:set-auto-hide', true);
  h.tick({ x: -1, y: -1 }, 0);
  h.tick({ x: -1, y: -1 }, 900);
  assert.equal(h.window.visible, false);
  h.tick({ x: bounds.x + 20, y: 1089 }, 1000);
  assert.equal(h.window.visible, true);
  await h.invoke('dock:set-height', 600);
  h.tick({ x: -1, y: -1 }, 1200);
  h.tick({ x: -1, y: -1 }, 2200);
  assert.equal(h.window.visible, true);
});

test('auto-hide polls only while enabled with a collapsed Dock and never stacks timers', async () => {
  const h = harness();
  assert.equal(h.activeTimers(), 0);
  await h.invoke('dock:set-auto-hide', true);
  await h.invoke('dock:set-auto-hide', true);
  assert.equal(h.activeTimers(), 1);
  await h.invoke('dock:set-height', 740);
  assert.equal(h.activeTimers(), 0);
  await h.invoke('dock:set-height', 188);
  assert.equal(h.activeTimers(), 1);
  await h.invoke('dock:set-auto-hide', false);
  assert.equal(h.activeTimers(), 0);
});


test('right-click cold launch and second instance deliver literal shortcut paths to the existing process', async () => {
  const imported = [];
  const service = { prepare: async file => imported.push(file) };
  const first = 'C:\\Users\\Demo\\desktop\\中文 & App.lnk';
  const second = 'C:\\Users\\Public\\Desktop\\New App.url';
  const h = harness({ argv: ['Lume Dock.exe', '--dock-import', first], importService: service });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(imported, [first]);
  h.events['second-instance'](null, ['Lume Dock.exe', '--dock-import', second]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(imported, [first, second]);
  const extra = harness({ ownsInstance: false });
  assert.equal(extra.window, undefined);
  assert.deepEqual(extra.calls, [['quit']]);
});

test('layout clamps values, keeps expansion height and restores the selected icon height', async () => {
  const h = harness();
  await h.invoke('dock:set-layout', { iconSize: 40, dockWidth: 40 });
  assert.equal(h.window.bounds.height, 147); assert.equal(h.window.bounds.width, 960);
  await h.invoke('dock:set-layout', { iconSize: 72, dockWidth: 80 });
  assert.equal(h.window.bounds.height, 202); assert.equal(h.window.bounds.width, 1272);
  await h.invoke('dock:set-layout', { iconSize: 40, dockWidth: 40 });
  assert.equal(h.window.bounds.height, 147); assert.equal(h.window.bounds.width, 960);
  await h.invoke('dock:set-height', 740);
  await h.invoke('dock:set-layout', { iconSize: 1000, dockWidth: 1000 });
  assert.equal(h.window.bounds.height, 740); assert.equal(h.window.bounds.width, 1272);
  await h.invoke('dock:set-height', 188); assert.equal(h.window.bounds.height, 202);
  const value = await h.invoke('dock:set-layout', { iconSize: 'bad', dockWidth: -1 });
  assert.equal(value.iconSize, 72); assert.equal(value.dockWidth, 40);
  assert.equal(h.window.bounds.y + h.window.bounds.height, 1082);
});
test('fullscreen hiding takes precedence over edge reveal; explicit show lasts until fullscreen ends', async () => {
  const h = harness();
  await h.invoke('dock:set-fullscreen-hide', true); await h.invoke('dock:set-auto-hide', true);
  h.fullscreen(true); assert.equal(h.window.visible, false);
  h.tick({ x: 900, y: 1089 }, 1000); assert.equal(h.window.visible, false);
  await h.invoke('dock:set-auto-hide', false); assert.equal(h.window.visible, false);
  h.reveal(); assert.equal(h.window.visible, true);
  h.fullscreen(true); assert.equal(h.window.visible, true);
  h.fullscreen(false); h.fullscreen(true); assert.equal(h.window.visible, false);
  await h.invoke('dock:set-fullscreen-hide', false); assert.equal(h.window.visible, true);
});
test('running IPC pauses hidden and expanded windows and invalidates after launch', async () => {
  const h = harness(), targets = ['C:/Tools/App.exe'];
  await h.invoke('dock:running-targets', targets, true); assert.deepEqual(h.processRequests[0], [targets, true]);
  await h.invoke('open-target', targets[0]); assert.equal(h.calls.at(-1)[0], 'invalidate');
  h.window.hide(); await h.invoke('dock:running-targets', targets); assert.equal(h.processRequests.length, 1);
  h.window.showInactive(); await h.invoke('dock:set-height', 740);
  await h.invoke('dock:running-targets', targets); assert.equal(h.processRequests.length, 1);
  await h.invoke('dock:set-height', 188); await h.invoke('dock:running-targets', targets); assert.equal(h.processRequests.length, 2);
});

test('programmatic fullscreen hide and explicit reveal publish native visibility', () => {
  const h = harness();
  h.invoke('dock:set-fullscreen-hide', true);
  h.fullscreen(true);
  assert.equal(h.window.isVisible(), false);
  assert.ok(h.calls.some(call => call[0] === 'send' && call[1] === 'dock:visibility' && call[2] === false));
  h.reveal();
  assert.equal(h.window.isVisible(), true);
  assert.ok(h.calls.some(call => call[0] === 'send' && call[1] === 'dock:visibility' && call[2] === true));
});

test('AppsFolder artwork loads on demand, shares bounded cache and never scans the catalog', async () => {
  const artwork = 'data:image/png;base64,AAAA';
  let reads = 0, disposed = 0;
  const h = harness({
    catalogService: { list: async () => { throw new Error('icon loading must not scan the catalog'); } },
    appIconReader: { get: async target => { reads++; return target === 'apps-folder:Vendor.App' ? artwork : null; }, dispose: () => disposed++ },
  });
  assert.equal(await h.invoke('get-icon','apps-folder:Vendor.App'), artwork);
  assert.equal(await h.invoke('get-icon','apps-folder:Vendor.App'), artwork);
  assert.equal(reads, 1, 'shared icon service caches the recovered icon');
  assert.equal(await h.invoke('get-icon','apps-folder:Vendor.Missing'), null);
  assert.equal(reads, 2);
  h.events['before-quit']({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, 1);
  assert.equal(await h.invoke('get-icon', 'apps-folder:After.Quit'), null);
  assert.equal(reads, 2, 'quit cannot restart the reader');
});


test('fast bottom approach crosses window gap and taskbar without hiding or showing twice', async () => {
  for (const iconSize of [40,64,72]) {
    const h = harness();
    await h.invoke('dock:set-layout',{iconSize,dockWidth:56});
    await h.invoke('dock:set-auto-hide',true);
    const bounds=h.window.getBounds(), x=bounds.x+bounds.width/2;
    h.tick({x:-1,y:-1},0);h.tick({x:-1,y:-1},900);
    assert.equal(h.window.visible,false);
    h.window.visibilityChanges.length=0;
    const messages=h.calls.filter(call=>call[0]==='send'&&call[1]==='dock:visibility').length;
    h.tick({x,y:1089},1000); // work-area bottom activates immediately
    h.tick({x,y:1084},1150); // gap under the native window, outside old 4px trigger
    h.tick({x,y:1084},2050);
    assert.equal(h.window.visible,true,'bottom gap remains interactive');
    h.tick({x,y:1110},2200); // inside the Windows taskbar band
    h.tick({x,y:1110},3100);
    assert.equal(h.window.visible,true,'taskbar transit must not count as leaving');
    h.tick({x:bounds.x-8,y:bounds.y+60},3250);
    h.tick({x:bounds.x-8,y:bounds.y+60},4150);
    assert.equal(h.window.visible,true,'small side jitter stays in retention range');
    h.tick({x,y:1129},4300); // physical screen bottom
    h.tick({x,y:bounds.y+80},4450); // settles onto the actual Dock
    assert.deepEqual(h.window.visibilityChanges,[true]);
    assert.equal(h.calls.filter(call=>call[0]==='send'&&call[1]==='dock:visibility').length,messages+1,'stationary cursor does not republish show notifications');
    h.tick({x:-1,y:-1},4600);h.tick({x:-1,y:-1},5200);
    assert.equal(h.window.visible,true);
    h.tick({x:-1,y:-1},5350);assert.equal(h.window.visible,false,'leaving still hides normally');
    assert.equal(h.activeTimers(),1);
  }
});

test('fresh edge reveal is protected from a quick overshoot and still yields to fullscreen', async () => {
  const h=harness();await h.invoke('dock:set-auto-hide',true);await h.invoke('dock:set-fullscreen-hide',true);
  const b=h.window.getBounds(), edge={x:b.x+50,y:1129};
  h.tick({x:-1,y:-1},0);h.tick({x:-1,y:-1},900);
  h.tick(edge,1000);h.tick({x:-1,y:-1},1010);h.tick({x:-1,y:-1},1800);
  assert.equal(h.window.visible,true,'minimum visible interval protects a fast overshoot');
  h.fullscreen(true);assert.equal(h.window.visible,false,'fullscreen overrides reveal hold');
  h.tick(edge,1900);assert.equal(h.window.visible,false);
  h.fullscreen(false);assert.equal(h.window.visible,true);
});

test('cursor on a display below the primary does not reveal its Dock', async () => {
  const h=harness();await h.invoke('dock:set-auto-hide',true);
  h.tick({x:-1,y:-1},0);h.tick({x:-1,y:-1},900);
  const b=h.window.getBounds();h.tick({x:b.x+50,y:1300},1000);
  assert.equal(h.window.visible,false);
});
