const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createTrayController } = require('../tray');

function harness() {
  const calls = { templates: [], contextMenus: [], destroyed: 0, tooltips: [], clicks: [] };
  class MockTray extends EventEmitter {
    setToolTip(value) { calls.tooltips.push(value); }
    setContextMenu(menu) { calls.contextMenus.push(menu); }
    destroy() { calls.destroyed++; }
  }
  const Menu = { buildFromTemplate(template) { calls.templates.push(template); return { template }; } };
  const nativeImage = { createFromPath(file) { calls.iconPath = file; return { resize(size) { calls.iconSize = size; return 'tray-icon'; } }; } };
  return { calls, MockTray, Menu, nativeImage };
}

test('tray menu provides show, settings, auto-hide and quit actions with current checked state', () => {
  const h = harness();
  const actions = [];
  let autoHide = true;
  const controller = createTrayController({
    platform: 'win32', Tray: h.MockTray, Menu: h.Menu, nativeImage: h.nativeImage,
    getAutoHide: () => autoHide,
    onShow: () => actions.push('show'), onSettings: () => actions.push('settings'),
    onToggleAutoHide: () => { actions.push('toggle'); autoHide = !autoHide; controller.refresh(); },
    onQuit: () => actions.push('quit'),
  });
  assert.ok(controller);
  assert.equal(h.calls.tooltips[0], 'Lume Dock');
  assert.deepEqual(h.calls.iconSize, { width: 16, height: 16 });
  let menu = h.calls.templates.at(-1);
  assert.deepEqual(menu.filter((item) => item.label).map((item) => item.label), [
    '打开 Lume Dock', '自动隐藏', '打开设置', '退出 Lume Dock',
  ]);
  assert.equal(menu.find((item) => item.label === '自动隐藏').checked, true);
  menu.find((item) => item.label === '打开 Lume Dock').click();
  menu.find((item) => item.label === '打开设置').click();
  menu.find((item) => item.label === '自动隐藏').click();
  menu = h.calls.templates.at(-1);
  assert.equal(menu.find((item) => item.label === '自动隐藏').checked, false);
  menu.find((item) => item.label === '退出 Lume Dock').click();
  controller.tray.emit('click');
  assert.deepEqual(actions, ['show', 'settings', 'toggle', 'quit', 'show']);
  controller.destroy();
  assert.equal(h.calls.destroyed, 1);
});

test('tray controller is Windows-only and safely handles absent optional icon methods', () => {
  const h = harness();
  assert.equal(createTrayController({ platform: 'darwin', Tray: h.MockTray, Menu: h.Menu, nativeImage: h.nativeImage }), null);
  assert.equal(createTrayController({ platform: 'win32', Menu: h.Menu, nativeImage: h.nativeImage }), null);
});
