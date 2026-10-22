const { app, BrowserWindow, ipcMain, powerMonitor } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { optionsFor } = require('../scripts/verify-windows.cjs');
const options = process.env.LUME_SOAK_OPTIONS ? JSON.parse(process.env.LUME_SOAK_OPTIONS) : optionsFor(process.argv.slice(2));
const reportPath = process.env.LUME_SOAK_REPORT || path.join(__dirname, '../reports/windows-soak.json');
if (process.platform !== 'win32' && !options.smoke) throw new Error('Native soak requires Windows.');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { version: require('../package.json').version, startedAt: new Date().toISOString(),
  platform: process.platform, arch: process.arch, electron: process.versions.electron,
  mode: options.smoke ? 'synthetic-smoke' : 'windows-native-development', options, status: 'running',
  units: { electronWorkingSetSize: 'KiB', rendererHeap: 'bytes', nativeWorkingSetAndPrivate: 'bytes', nativeCpuTotal: 'ms' },
  samples: [], events: [], activity: { catalogCalls: 0, appIconRequests: 0, appIconWorkerStarts: 0 },
  limitations: 'Development Electron with isolated settings. Smoke uses synthetic catalogs and a Node icon helper. Native mode uses real Windows discovery/icons. Working sets include shared pages; do not sum them as exclusive memory. Passing is not a guarantee against long-term leaks or installer issues.' };
function save() { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lume-native-soak-'));
app.setPath('userData', temp);
const appCatalog = require('../windows-apps');
const originalCatalog = appCatalog.createAppCatalog;
appCatalog.createAppCatalog = () => {
  const catalog = options.smoke ? originalCatalog({ platform: 'win32', env: {},
    io: { readFile: fs.promises.readFile, readdir: async () => [] },
    run: async () => ({ stdout: JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ name: `Soak App ${String(i).padStart(4, '0')}`, appId: `Lume.Fixture.${i}` }))) }),
  }) : originalCatalog();
  return { list: async (...args) => { report.activity.catalogCalls++; const result = await catalog.list(...args);
    report.catalogEntries = result.items.length;
    assert.ok(result.items.every(item => !Object.hasOwn(item, 'icon')), 'catalog must contain no native PNG payloads');
    return result; } };
};
const nativeReader = require('../app-icon-reader');
const originalReader = nativeReader.createAppIconReader;
const helpers = require('../helper-processes');
const appIconChildren = new Set();
nativeReader.createAppIconReader = () => {
  const reader = originalReader({ supported: true, spawnProcess: (exe, args, settings) => {
    const child = options.smoke ? helpers.spawn(process.execPath, [path.join(__dirname, 'app-icon-worker-fixture.cjs')],
      { ...settings, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }) : helpers.spawn(exe, args, settings);
    report.activity.appIconWorkerStarts++;
    appIconChildren.add(child);
    child.once('close', () => appIconChildren.delete(child));
    return child;
  } });
  return { get: target => { report.activity.appIconRequests++; return reader.get(target); }, dispose: () => reader.dispose() };
};
require('../main');
if (options.smoke) {
  ipcMain.removeHandler('scan-desktop'); ipcMain.handle('scan-desktop', () => ({ items: [] }));
  ipcMain.removeHandler('get-icon');
  const reader = nativeReader.createAppIconReader();
  const icons = require('../icon-service').createIconService({ load: target => target.startsWith('apps-folder:') ? reader.get(target) : null });
  ipcMain.handle('get-icon', (_event, target) => icons.get(target));
  app.on('before-quit', () => reader.dispose());
}
let win;
let finished = false;
const errors = [];
async function treeMemory() {
  if (process.platform !== 'win32' || options.smoke) return null;
  const script = fs.readFileSync(path.join(__dirname, '../scripts/process-memory.ps1'), 'utf8');
  const command = Buffer.from('& {\n' + script + '\n} -RootPid ' + process.pid, 'utf16le').toString('base64');
  const executable = path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise(resolve => execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command],
    { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      try { if (error) throw error; resolve({ processes: JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) }); }
      catch { resolve({ error: 'Windows process-memory sampler unavailable' }); }
    }));
}
async function sample(phase) {
  const processes = app.getAppMetrics().map(({ pid, type, cpu, memory }) => ({ pid, type, cpu, memory }));
  const heap = await win.webContents.debugger.sendCommand('Runtime.getHeapUsage');
  const nativeProcessTree = await treeMemory();
  report.samples.push({ at: new Date().toISOString(), phase, processes, rendererHeap: heap,
    nativeProcessTree, activeAppIconWorkers: appIconChildren.size });
  save(); console.log(`Sample ${phase}: ${processes.length} Electron processes; heap ${(heap.usedSize / 1048576).toFixed(2)} MiB`);
  if (!options.smoke) assert.ok(nativeProcessTree?.processes?.some(record => record.pid === process.pid), 'native process sampler must include the main process');
}
async function finish(error) {
  if (finished) return;
  finished = true;
  report.status = error ? 'failed' : 'passed';
  report.finishedAt = new Date().toISOString();
  if (error) { report.error = String(error.stack || error); console.error(error); }
  report.rendererErrors = errors;
  save();
  try { win?.webContents.debugger.detach(); } catch {}
  if (error) process.exitCode = 1;
  // Exercise normal application cleanup, including the helper registry.
  app.quit();
}
// app.exit(0) in production cleanup is intentional; preserve failure in the
// saved report, and have the outer runner inspect its status as well.
app.whenReady().then(async () => {
  win = BrowserWindow.getAllWindows()[0];
  win.webContents.on('render-process-gone', (_event, details) => void finish(new Error('Renderer exited: ' + details.reason)));
  win.on('unresponsive', () => void finish(new Error('Window became unresponsive')));
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message.slice(0, 2000)); });
  for (const event of ['suspend', 'resume', 'lock-screen', 'unlock-screen']) powerMonitor.on(event, () => {
    report.events.push({ at: new Date().toISOString(), event }); save();
  });
  const js = source => win.webContents.executeJavaScript(source);
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await js('window.dockReady');
  win.webContents.debugger.attach('1.3');
  await sample('startup');
  const start = Date.now();
  await js('launcher.open()');
  report.firstOpenMs = Date.now() - start;
  assert.ok(report.catalogEntries > 0, 'application discovery must return entries');
  // Allow actual paints and icon decoding; discovery never waits for artwork.
  await pause(options.smoke ? 250 : 2000);
  const counts = await js(`({ cells: document.querySelectorAll('.app-cell').length,
    loadedImages: [...document.querySelectorAll('.app-art img')].filter(image => image.getAttribute('src')?.startsWith('data:image/png;base64,') && image.complete && image.naturalWidth > 0).length })`);
  report.firstOpen = { ...counts, appIconRequests: report.activity.appIconRequests };
  if (options.smoke) {
    assert.ok(counts.loadedImages > 0, 'visible AppsFolder artwork is decoded');
    assert.ok(report.activity.appIconRequests < report.catalogEntries / 2, 'opening the launcher must not eagerly request the whole catalog');
  }
  await sample('launcher-open');
  await js('launcher.close()');
  const firstName = await js(`items.find(item => item.type !== 'separator')?.name || ''`);
  for (let i = 0; i < options.cycles; i++) {
    await js(`(async () => {
      await launcher.open();
      const input = document.querySelector('#appSearch');
      for (const value of [${JSON.stringify(firstName)}, '__lume_missing_fixture__', '']) {
        input.value = value; input.dispatchEvent(new Event('input'));
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      launcher.close();
      if (document.querySelectorAll('.app-cell').length) throw new Error('Closed launcher retained cells');
    })()`);
    if ((i + 1) % 25 === 0) console.log(`Interaction cycles: ${i + 1}/${options.cycles}`);
  }
  report.completedCycles = options.cycles;
  await pause(2300);
  assert.equal(appIconChildren.size, 0, 'idle artwork reader must exit and release its process');
  await sample('after-cycles-idle');
  const deadline = Date.now() + options.minutes * 60000;
  while (Date.now() < deadline) {
    await pause(Math.min(options.intervalSeconds * 1000, deadline - Date.now()));
    if (finished) return;
    await sample('idle');
  }
  // Confirm artwork still works after the reader has been released.
  await js('launcher.open()'); await pause(options.smoke ? 200 : 1000); await js('launcher.close()');
  await pause(2300); assert.equal(appIconChildren.size, 0);
  await sample('final-idle');
  assert.deepEqual(errors, []);
  await finish();
}).catch(finish);
