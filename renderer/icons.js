(() => {
  const base = './assets/macos/';
  const defaults = new Set(['apps', 'browser', 'files', 'terminal', 'music', 'notes', 'calendar', 'downloads']);
  const functionalIcons = new Map([
    ['计算器', 'calculator'], ['calculator', 'calculator'], ['照片', 'photos'], ['photos', 'photos'],
    ['邮件', 'mail'], ['mail', 'mail'], ['地图', 'maps'], ['maps', 'maps'], ['时钟', 'clock'],
    ['clock', 'clock'], ['设置', 'settings'], ['settings', 'settings'], ['提醒事项', 'reminders'],
  ]);
  function preferred(item) {
    const custom = window.customIconStore?.get(item);
    if (custom) return custom;
    if (item.target?.startsWith('preview:')) return `${base}${item.id}.png`;
    if (item.id === 'recycle-bin') return `${base}recycle-bin.svg`;
    if (defaults.has(item.id)) return `${base}${item.id}.png`;
    if (item.icon?.startsWith('data:image/png;base64,')) return item.icon;
    return null;
  }
  function fallback(item) {
    const match = functionalIcons.get(String(item.name || '').toLocaleLowerCase());
    return `${base}${match || 'generic'}.png`;
  }
  window.dockIcons = { preferred, fallback, asset: (name) => `${base}${name}.png`,
    previewApps: ['apps', 'browser', 'files', 'terminal', 'music', 'notes', 'calendar', 'downloads', 'calculator', 'photos', 'mail', 'maps', 'clock', 'reminders', 'settings']
      .map((id, index) => ({ id, name: ['全部应用', '浏览器', '文件', '终端', '音乐', '便签', '日历', '下载', '计算器', '照片', '邮件', '地图', '时钟', '提醒事项', '设置'][index], target: `preview:${id}`, icon: null, source: '外观预览' })),
  };
})();
