const { app, BrowserWindow, ipcMain, screen, shell, dialog, Menu, Tray, nativeImage, globalShortcut } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const helperProcesses = require('./helper-processes');

let win;
let settingsWin;
let settingsBounds;
let quitting = false;
const DOCK_HEIGHT = 188;
const DOCK_SIDE_GUTTER = 96;
let expanded = false;
let panelHeight = 600;
let autoHide = false;
let hideTimer;
const autoHidePolicy = require('./auto-hide').createAutoHidePolicy();
let appCatalog;
let appIdentities;
let desktopIntegration;
let importError = '';
let trayController;
let iconService;
let processService;
let fullscreenMonitor;
let layout = { iconSize: 64, dockWidth: 56 };
const fullscreenPolicy = require(path.join(__dirname, 'fullscreen-monitor')).createFullscreenPolicy();
function collapsedHeight() { return Math.round(DOCK_HEIGHT + (layout.iconSize - 64) * 1.7); }
function applyFullscreenState(active) {
  const wasHidden = fullscreenPolicy.shouldHide;
  fullscreenPolicy.update(active);
  if (!win || win.isDestroyed()) return;
  if (settingsWin && !settingsWin.isDestroyed()) setDockVisible(true);
  else if (fullscreenPolicy.shouldHide) setDockVisible(false);
  else if (wasHidden) { autoHidePolicy.reset(); setDockVisible(true); }
}
const ownsInstance = app.requestSingleInstanceLock();
const exitRequest = process.argv.includes('--quit');
if (!ownsInstance) app.quit();
function integration() {
  desktopIntegration ??= require(path.join(__dirname, 'windows-integration')).createIntegration({
    directory: app.getPath('userData'), executable: process.execPath,
    supported: process.platform === 'win32' && app.isPackaged,
    nativePath: process.platform === 'win32' ? path.win32 : path,
    desktops: async () => desktopRoots(), trashItem: (file) => shell.trashItem(file),
    notify: () => win?.webContents?.send('desktop-imports-changed'),
  });
  return desktopIntegration;
}
function setDockVisible(visible) {
  if (quitting) return;
  if (!win || win.isDestroyed()) return;
  if (visible !== win.isVisible()) {
    if (visible) win.showInactive();
    else win.hide();
  }
  // Native show/hide events may arrive late or be absent for an inactive window.
  sendToRenderer('dock:visibility', win.isVisible());
}

function showDock({ focus = false } = {}) {
  if (quitting) return;
  if (!win || win.isDestroyed()) return;
  fullscreenPolicy.reveal();
  autoHidePolicy.reset();
  if (!win.isVisible()) setDockVisible(true);
  if (focus) win.focus();
}

function sendToRenderer(channel, ...args) {
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => win.webContents.send(channel, ...args));
  } else {
    win.webContents.send(channel, ...args);
  }
}

function createTray() {
  trayController = require(path.join(__dirname, 'tray')).createTrayController({
    Tray, Menu, nativeImage,
    getAutoHide: () => autoHide,
    onShow: () => showDock(),
    onSettings: () => openSettingsWindow(),
    onToggleAutoHide: () => {
      autoHide = !autoHide;
      syncAutoHideTimer();
      autoHidePolicy.reset();
      if (!autoHide && !fullscreenPolicy.shouldHide && win && !win.isDestroyed() && !win.isVisible()) setDockVisible(true);
      trayController?.refresh();
      sendToRenderer('tray:auto-hide', autoHide);
    },
    onQuit: () => app.quit(),
  });
}

function registerShortcuts() {
  if (typeof globalShortcut?.register !== 'function') return;
  try {
    globalShortcut.register('CommandOrControl+Alt+Space', () => {
      showDock({ focus: true });
      sendToRenderer('shortcut:open-launcher');
    });
  } catch { /* A denied shortcut must not prevent the Dock from starting. */ }
}

function desktopRoots() {
  const nativePath = process.platform === 'win32' ? path.win32 : path;
  const roots = [app.getPath('desktop')];
  if (process.platform === 'win32') roots.push(nativePath.join(process.env.PUBLIC || nativePath.join(process.env.SystemDrive || 'C:', 'Users', 'Public'), 'Desktop'));
  return roots;
}
async function handleImport(argv) {
  const source = require(path.join(__dirname, 'windows-integration')).cliImport(argv);
  if (!source) return;
  try { await integration().prepare(source); }
  catch (error) { importError = error.message; win?.webContents?.send('desktop-imports-changed'); }
  if (win && !win.isDestroyed()) showDock();
}
app.on('second-instance', (_event, argv) => {
  if (argv.includes('--quit')) { app.quit(); return; }
  if (!quitting) void handleImport(argv);
});
ipcMain.handle('desktop-integration:status', () => integration().status());
ipcMain.handle('desktop-integration:set', (_event, enabled) => integration().setEnabled(enabled));
ipcMain.handle('desktop-integration:pending', async () => {
  const items = await integration().pending();
  const error = importError; importError = '';
  return { items, error };
});
ipcMain.handle('desktop-integration:ack', async (_event, id) => {
  try { return await integration().acknowledge(id); }
  catch (error) { return { ok: false, message: error.message }; }
});

ipcMain.handle('list-apps', async (_event, options) => {
  appCatalog ??= require('./windows-apps').createAppCatalog();
  appIdentities ??= require('./app-identities').createIdentityResolver();
  const result = await appCatalog.list({ refresh: options?.refresh === true });
  const local = Array.isArray(options?.targets) ? options.targets.slice(0, 3000) : [];
  const identities = await appIdentities.get([...result.items.map(item => item.target), ...local], options?.refresh === true);
  return { ...result, identities };
});

async function launchDetached(command, args = []) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function dockBounds() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const shelfWidth = Math.min(Math.max(Math.round(width * layout.dockWidth / 100), 600), 1080);
  const dockWidth = Math.min((expanded ? Math.max(720, shelfWidth) : shelfWidth) + DOCK_SIDE_GUTTER * 2, width - 16);
  const dockHeight = Math.min(expanded ? panelHeight : collapsedHeight(), height - 16);
  return {
    x: x + Math.round((width - dockWidth) / 2),
    y: y + height - dockHeight - 8,
    width: dockWidth,
    height: dockHeight,
  };
}

function syncAutoHideTimer() {
  autoHidePolicy.reset();
  clearInterval(hideTimer);
  hideTimer = null;
  if (quitting || !autoHide || expanded || settingsWin || !win || win.isDestroyed()) return;
  hideTimer = setInterval(() => {
    if (!autoHide || expanded || !win || win.isDestroyed()) return;
    if (fullscreenPolicy.shouldHide) { if (win.isVisible()) setDockVisible(false); return; }
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const { bounds: display, workArea } = screen.getPrimaryDisplay();
    const visible = win.isVisible();
    const desired = autoHidePolicy.update({ cursor, bounds, display, workArea, visible, now: Date.now() });
    if (desired !== visible) setDockVisible(desired);
  }, 150);
}

function updateDisplayBounds() {
  // Do not round-trip settings window bounds on Dock slider changes.
  if (win && !win.isDestroyed()) win.setBounds(dockBounds());
}

function handleDisplayMetricsChanged() {
  autoHidePolicy.reset();
  updateDisplayBounds();
  if (!settingsWin || settingsWin.isDestroyed()) return;
  const current = settingsWin.getBounds();
  const next = clampSettingsBounds(current);
  if (['x', 'y', 'width', 'height'].some(key => current[key] !== next[key])) settingsWin.setBounds(next);
}

function clampSettingsBounds(previous) {
  const display = (previous && screen.getDisplayMatching?.(previous)) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(previous?.width || 1000, area.width - 24);
  const height = Math.min(previous?.height || 620, area.height - 24);
  return { width, height,
    x: Math.round(Math.max(area.x + 12, Math.min(previous?.x ?? area.x + (area.width - width) / 2, area.x + area.width - width - 12))),
    y: Math.round(Math.max(area.y + 12, Math.min(previous?.y ?? area.y + 20, area.y + area.height - height - 12))),
  };
}

function openSettingsWindow() {
  if (quitting) return;
  showDock();
  expanded = false;
  updateDisplayBounds();
  sendToRenderer('settings:preview');
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show(); settingsWin.focus();
    return;
  }
  // Leave room for the largest Dock so every size adjustment stays visible.
  const area = screen.getPrimaryDisplay().workArea;
  const bounds = clampSettingsBounds(settingsBounds || {
    width: Math.min(1000, area.width - 24), height: Math.min(620, Math.max(240, area.height - 236)),
    x: area.x + Math.round((area.width - Math.min(1000, area.width - 24)) / 2), y: area.y + 12,
  });
  const panel = settingsWin = new BrowserWindow({
    ...bounds, title: 'Lume Dock · 程序坞设置',
    minWidth: Math.min(600, bounds.width), minHeight: Math.min(320, bounds.height),
    frame: false, transparent: false, backgroundColor: '#242428',
    resizable: true, movable: true, maximizable: false, minimizable: false,
    show: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  panel.setAlwaysOnTop(true, 'floating');
  syncAutoHideTimer();
  panel.once('ready-to-show', () => { if (!panel.isDestroyed()) panel.show(); });
  panel.on('close', () => { settingsBounds = panel.getBounds(); });
  panel.on('closed', () => {
    if (settingsWin === panel) settingsWin = null;
    autoHidePolicy.reset();
    syncAutoHideTimer();
    if (fullscreenPolicy.shouldHide) setDockVisible(false);
  });
  panel.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { view: 'settings' } });
}

ipcMain.handle('settings:open', () => openSettingsWindow());
ipcMain.handle('settings:close', () => settingsWin?.close());

function createWindow() {
  const bounds = dockBounds();
  win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(400, bounds.width),
    minHeight: Math.min(140, bounds.height),
    maxWidth: 1080 + DOCK_SIDE_GUTTER * 2,
    maxHeight: 760,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!fullscreenPolicy.shouldHide) setDockVisible(true); });
  win.on?.('show', () => sendToRenderer('dock:visibility', true));
  win.on?.('hide', () => sendToRenderer('dock:visibility', false));
  syncAutoHideTimer();
  screen.on('display-metrics-changed', handleDisplayMetricsChanged);
  win.on?.('closed', () => {
    settingsWin?.destroy();
    clearInterval(hideTimer);
    screen.removeListener?.('display-metrics-changed', handleDisplayMetricsChanged);
    win = null;
  });
}

if (ownsInstance && !exitRequest) app.whenReady().then(() => {
  if (quitting) return;
  createWindow();
  registerShortcuts();
  if (process.platform === 'win32') {
    createTray();
    void handleImport(process.argv);
  }
});
if (ownsInstance && exitRequest) app.whenReady().then(() => app.quit());

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  clearInterval(hideTimer);
  globalShortcut?.unregisterAll?.();
  trayController?.destroy();
  trayController = null;
  fullscreenMonitor?.dispose();
  processService?.clear();
  // Destroy both renderers before waiting; their close callbacks must not restart work.
  settingsWin?.destroy();
  win?.destroy();
  void helperProcesses.stop().then(remaining => {
    if (remaining.length) {
      try { fs.writeFileSync(path.join(app.getPath('userData'), 'shutdown-last.json'), JSON.stringify({ at: new Date().toISOString(), helperPids: remaining })); } catch {}
    }
  }).finally(() => app.exit(0));
});

ipcMain.handle('open-target', async (_event, target) => {
  if (quitting) return { ok: false, message: '程序坞正在退出' };
  if (typeof target !== 'string' || !target.trim()) return { ok: false, message: '没有设置打开目标' };
  target = target.trim();
  try {
    if (target.startsWith('apps-folder:')) {
      const appId = target.slice('apps-folder:'.length);
      if (process.platform !== 'win32' || !appId || appId.length > 2048 || /[\x00-\x1f]/.test(appId)) {
        return { ok: false, message: '无法启动这个 Windows 应用，请刷新应用列表后重试' };
      }
      const explorer = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe');
      await launchDetached(explorer, [`shell:AppsFolder\\${appId}`]);
    }
    // Windows URI schemes (https:, ms-settings:, ms-calendar:, etc.) must go
    // through the shell. This also keeps custom protocol shortcuts working.
    else if (!path.win32.isAbsolute(target) && /^[a-z][a-z\d+.-]*:/i.test(target)) {
      await shell.openExternal(target);
    } else if (process.platform === 'win32' && /^(wt|wt\.exe|cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe|explorer|explorer\.exe|notepad|notepad\.exe)$/i.test(target)) {
      // shell.openPath cannot resolve a command that lives on PATH. Spawn it
      // detached so the dock stays responsive while the app remains open.
      await launchDetached(target);
    } else {
      const result = await shell.openPath(target);
      if (result) return { ok: false, message: result };
    }
    processService?.invalidate();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('recycle-bin:open', async () => {
  if (process.platform !== 'win32') return { ok: false, message: '回收站入口仅支持 Windows' };
  try {
    const explorer = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe');
    await launchDetached(explorer, ['shell:RecycleBinFolder']);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('recycle-bin:empty', async () => {
  if (process.platform !== 'win32') return { ok: false, message: '清空回收站仅支持 Windows' };
  const confirmation = await dialog.showMessageBox(win, {
    type: 'warning',
    title: '清空回收站',
    message: '确定永久删除回收站中的所有项目吗？',
    detail: '此操作无法撤销。',
    buttons: ['取消', '清空回收站'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (confirmation.response !== 1) return { ok: false, canceled: true };
  try {
    await new Promise((resolve, reject) => {
      helperProcesses.track(execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -ErrorAction Stop'], { windowsHide: true, timeout: 120000 }, (error) => error ? reject(error) : resolve()));
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('scan-desktop', async () => {
  const nativePath = process.platform === 'win32' ? path.win32 : path;
  // Electron resolves redirected/OneDrive user desktops via the OS known folder.
  const desktops = desktopRoots();
  const items = [];
  const warnings = [];
  let readable = 0;
  for (const desktop of new Set(desktops)) {
    try {
      const entries = await fs.promises.readdir(desktop, { withFileTypes: true });
      readable++;
      for (const entry of entries) {
        if ((!entry.isFile() && !entry.isSymbolicLink()) || !/\.(lnk|url|exe|bat|cmd|ps1)$/i.test(entry.name)) continue;
        items.push({
          name: entry.name.replace(/\.(lnk|url|exe|bat|cmd|ps1)$/i, ''),
          target: nativePath.join(desktop, entry.name),
          glyph: entry.name.slice(0, 1).toUpperCase(),
          color: 'blue',
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') warnings.push(`无法读取 ${desktop}：${error.message}`);
    }
  }
  return { items, warnings, ...(readable ? {} : { error: '无法读取桌面，请使用手动添加或稍后重新扫描' }) };
});

ipcMain.handle('pick-target', async (_event, kind) => {
  if (kind !== 'file' && kind !== 'folder') return { error: '请选择文件或文件夹' };
  try {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents?.(_event?.sender) || win, {
      title: kind === 'folder' ? '选择文件夹' : '选择程序或快捷方式',
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
      ...(kind === 'file' ? { filters: [
        { name: '程序与快捷方式', extensions: ['lnk', 'url', 'exe', 'bat', 'cmd', 'ps1'] },
        { name: '所有文件', extensions: ['*'] },
      ] } : {}),
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const target = result.filePaths[0];
    const nativePath = process.platform === 'win32' ? path.win32 : path;
    const basename = nativePath.basename(target);
    return { target, name: kind === 'folder' ? basename : basename.replace(/\.[^.]+$/, '') };
  } catch (error) {
    return { error: error.message };
  }
});

let customIconPickerPending = false;
ipcMain.handle('pick-custom-icon', async (event) => {
  if (customIconPickerPending) return { ok: false, message: '请先完成当前图标选择' };
  customIconPickerPending = true;
  try {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents?.(event?.sender) || win, {
      title: '选择自定义图标', properties: ['openFile'],
      filters: [{ name: '图标图片', extensions: ['png', 'jpg', 'jpeg', 'ico'] }],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, icon: await require('./custom-icon-image').readCustomIcon(result.filePaths[0], nativeImage) };
  } catch (error) { return { ok: false, message: error.message || '无法读取图标图片' }; }
  finally { customIconPickerPending = false; }
});

ipcMain.handle('get-icon', async (_event, target) => {
  if (process.platform !== 'win32') return null;
  iconService ??= require('./icon-service').createIconService({
    load: require('./windows-icons').createWindowsIconLoader({
      readIcon: async file => {
        if (file.startsWith('apps-folder:')) {
          appCatalog ??= require('./windows-apps').createAppCatalog();
          const result = await appCatalog.list();
          return result.items.find(item => item.target === file)?.icon || null;
        }
        const icon = await app.getFileIcon(file, { size: 'large' });
        return icon.isEmpty() ? null : icon.toDataURL();
      },
    }),
  });
  return iconService.get(target);
});

ipcMain.handle('get-default-targets', () => ({
  files: app.getPath('home'),
  downloads: app.getPath('downloads'),
  music: app.getPath('music'),
  calendar: 'ms-calendar:',
  notes: 'ms-stickynotes:',
}));

ipcMain.handle('config:export', async (_event, payload) => {
  try {
    const serialized = JSON.stringify(payload, null, 2);
    if (Buffer.byteLength(serialized, 'utf8') > 8_000_000) return { ok: false, message: '配置文件过大，无法导出' };
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents?.(_event?.sender) || win, {
      title: '导出 Lume Dock 配置',
      defaultPath: 'lume-dock-config.json',
      filters: [{ name: 'Lume Dock 配置', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.promises.writeFile(result.filePath, serialized, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('config:import', async (_event) => {
  try {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents?.(_event?.sender) || win, {
      title: '导入 Lume Dock 配置',
      properties: ['openFile'],
      filters: [{ name: 'Lume Dock 配置', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    const stat = await fs.promises.stat(result.filePaths[0]);
    if (stat.size > 8_000_000) return { ok: false, message: '配置文件过大，无法导入' };
    const data = JSON.parse(await fs.promises.readFile(result.filePaths[0], 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, message: '配置文件格式不正确' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: '无法读取配置文件，请选择有效的 JSON 配置' };
  }
});

ipcMain.handle('system-info:battery', async () => {
  try { return await require(path.join(__dirname, 'system-info')).getBattery(); }
  catch { return null; }
});

ipcMain.handle('dock:set-height', (_event, height) => {
  if (_event?.sender && _event.sender === settingsWin?.webContents) return;
  if (!win || win.isDestroyed()) return;
  expanded = Number(height) >= 300;
  syncAutoHideTimer();
  panelHeight = Math.min(Math.max(Number(height) || 600, 300), 760);
  autoHidePolicy.reset();
  win.setBounds(dockBounds());
  if (!fullscreenPolicy.shouldHide && !win.isVisible()) setDockVisible(true);
  if (expanded) win.focus?.();
});

ipcMain.handle('dock:set-auto-hide', (_event, enabled) => {
  autoHide = Boolean(enabled);
  syncAutoHideTimer();
  trayController?.refresh();
  autoHidePolicy.reset();
  if (!fullscreenPolicy.shouldHide && win && !win.isDestroyed() && !win.isVisible()) setDockVisible(true);
});

ipcMain.handle('dock:set-layout', (_event, value) => {
  if (!value || typeof value !== 'object') return layout;
  const size = Number(value.iconSize), width = Number(value.dockWidth);
  layout = { iconSize: Number.isFinite(size) ? Math.max(40, Math.min(72, size)) : layout.iconSize,
    dockWidth: Number.isFinite(width) ? Math.max(40, Math.min(100, width)) : layout.dockWidth };
  updateDisplayBounds();
  return layout;
});
ipcMain.handle('dock:set-fullscreen-hide', (_event, enabled) => {
  fullscreenMonitor ??= require(path.join(__dirname, 'fullscreen-monitor')).createFullscreenMonitor({ onState: applyFullscreenState });
  fullscreenMonitor.setEnabled(enabled === true);
});
ipcMain.handle('dock:running-targets', async (_event, targets, refresh) => {
  if (!win || win.isDestroyed() || !win.isVisible() || expanded) return { targets: [] };
  processService ??= require(path.join(__dirname, 'windows-processes')).createProcessService();
  return processService.get(targets, refresh === true);
});

ipcMain.handle('dock:set-login-item', (_event, enabled) => {
  if (process.platform !== 'win32') return false;
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('dock:quit', () => app.quit());

