const path = require('node:path');

/**
 * Build the Windows notification-area menu without coupling it to Electron's
 * global app state. The small adapter makes the menu easy to exercise in Node
 * tests and keeps tray lifecycle code out of the main window logic.
 */
function createTrayController({
  platform = process.platform,
  Tray,
  Menu,
  nativeImage,
  iconPath = path.join(__dirname, 'renderer', 'assets', 'macos', 'apps.png'),
  getAutoHide = () => false,
  onShow = () => {},
  onSettings = () => {},
  onToggleAutoHide = () => {},
  onQuit = () => {},
} = {}) {
  if (platform !== 'win32' || typeof Tray !== 'function' || typeof Menu?.buildFromTemplate !== 'function') return null;

  const source = nativeImage?.createFromPath?.(iconPath);
  const icon = source?.resize ? source.resize({ width: 16, height: 16 }) : source;
  const tray = new Tray(icon);
  tray.setToolTip?.('Lume Dock');

  function refresh() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 Lume Dock', click: onShow },
      { type: 'separator' },
      { label: '自动隐藏', type: 'checkbox', checked: Boolean(getAutoHide()), click: onToggleAutoHide },
      { label: '打开设置', click: onSettings },
      { type: 'separator' },
      { label: '退出 Lume Dock', click: onQuit },
    ]));
  }

  tray.on?.('click', onShow);
  refresh();
  return { tray, refresh, destroy: () => tray.destroy?.() };
}

module.exports = { createTrayController };
