const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dockAPI', {
  openSettings: () => ipcRenderer.invoke('settings:open'),
  closeSettings: () => { void ipcRenderer.invoke('settings:close').catch(() => {}); },
  onSettingsPreview: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('settings:preview', listener);
    return () => ipcRenderer.removeListener('settings:preview', listener);
  },
  openTarget: (target) => ipcRenderer.invoke('open-target', target),
  openRecycleBin: () => ipcRenderer.invoke('recycle-bin:open'),
  emptyRecycleBin: () => ipcRenderer.invoke('recycle-bin:empty'),
  scanDesktop: () => ipcRenderer.invoke('scan-desktop'),
  listApps: (options) => ipcRenderer.invoke('list-apps', options),
  pickTarget: (kind) => ipcRenderer.invoke('pick-target', kind),
  getIcon: (target) => ipcRenderer.invoke('get-icon', target),
  pickCustomIcon: () => ipcRenderer.invoke('pick-custom-icon'),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  getDefaultTargets: () => ipcRenderer.invoke('get-default-targets'),
  exportConfig: (payload) => ipcRenderer.invoke('config:export', payload),
  importConfig: () => ipcRenderer.invoke('config:import'),
  getBattery: () => ipcRenderer.invoke('system-info:battery'),
  setHeight: (height) => ipcRenderer.invoke('dock:set-height', height),
  setLayout: (layout) => ipcRenderer.invoke('dock:set-layout', layout),
  setFullscreenHide: (enabled) => ipcRenderer.invoke('dock:set-fullscreen-hide', enabled),
  getRunningTargets: (targets, refresh = false) => ipcRenderer.invoke('dock:running-targets', targets, refresh === true),
  onVisibilityChanged: (callback) => {
    const listener = (_event, visible) => callback(visible === true);
    ipcRenderer.on('dock:visibility', listener);
    return () => ipcRenderer.removeListener('dock:visibility', listener);
  },
  setAutoHide: (enabled) => ipcRenderer.invoke('dock:set-auto-hide', enabled),
  setLoginItem: (enabled) => ipcRenderer.invoke('dock:set-login-item', enabled),
  integrationStatus: () => ipcRenderer.invoke('desktop-integration:status'),
  setDesktopIntegration: (enabled) => ipcRenderer.invoke('desktop-integration:set', enabled),
  pendingDesktopImports: () => ipcRenderer.invoke('desktop-integration:pending'),
  acknowledgeDesktopImport: (id) => ipcRenderer.invoke('desktop-integration:ack', id),
  onTrayOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('tray:open-settings', listener);
    return () => ipcRenderer.removeListener('tray:open-settings', listener);
  },
  onTrayAutoHide: (callback) => {
    const listener = (_event, enabled) => callback(Boolean(enabled));
    ipcRenderer.on('tray:auto-hide', listener);
    return () => ipcRenderer.removeListener('tray:auto-hide', listener);
  },
  onShortcutOpenLauncher: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('shortcut:open-launcher', listener);
    return () => ipcRenderer.removeListener('shortcut:open-launcher', listener);
  },
  onDesktopImportsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('desktop-imports-changed', listener);
    return () => ipcRenderer.removeListener('desktop-imports-changed', listener);
  },
  quit: () => ipcRenderer.invoke('dock:quit'),
});
