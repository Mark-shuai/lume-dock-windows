const STORAGE_KEY = 'lume-dock-items-v1';
const SETTINGS_KEY = 'lume-dock-settings-v1';
const DISMISSED_KEY = 'lume-dock-dismissed-v1';
const RECENT_KEY = 'lume-dock-recent-v1';
const LIBRARY_KEY = 'lume-dock-library-v1';

const defaults = [
  { id: 'browser', name: '浏览器', target: 'https://www.bing.com', glyph: '⌁', color: 'blue', pinned: true },
  { id: 'files', name: '文件', target: '', glyph: '▰', color: 'amber', pinned: true },
  { id: 'terminal', name: '终端', target: 'wt.exe', glyph: '>_', color: 'mint', pinned: true },
  { id: 'music', name: '音乐', target: '', glyph: '♪', color: 'rose', pinned: true },
  { id: 'notes', name: '便签', target: '', glyph: 'N', color: 'amber', pinned: true },
  { id: 'calendar', name: '日历', target: '', glyph: '31', color: 'blue', pinned: true },
  { id: 'downloads', name: '下载', target: '', glyph: '↓', color: 'mint', pinned: true },
];

const colorMap = {
  amber: ['oklch(0.27 0.055 77)', 'oklch(0.83 0.14 77)'],
  blue: ['oklch(0.23 0.055 237)', 'oklch(0.8 0.13 220)'],
  mint: ['oklch(0.24 0.06 160)', 'oklch(0.82 0.13 160)'],
  rose: ['oklch(0.27 0.065 15)', 'oklch(0.82 0.14 18)'],
};

const allowedColors = new Set(Object.keys(colorMap));
const allowedThemes = new Set(['system', 'light', 'dark']);
const defaultSettings = {
  autoHide: false, launch: false, magnify: true, systemInfo: false, theme: 'dark',
  lyricsBar: false, lyricsTitle: '', lyricsArtist: '', lyricsText: '', lyricsAutoPlay: true, lyricsInterval: 4,
  showRecycleBin: true, runningIndicators: true, hideOnFullscreen: true,
  accentColor: '#0A84FF', iconSize: 64, dockWidth: 56,
  glassRadius: 22, glassOpacity: 35, glassBlur: 28, glassHighlight: 65, glassShadow: 24,
};

function boundedString(value, max = 4096) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max) : '';
}

function safeTarget(value) {
  const target = boundedString(value, 4096);
  return target && !/^(?:javascript|data|vbscript):/i.test(target) ? target : '';
}

function normalizeItems(value, fallback = [], allowPlaceholders = false, limit = 500) {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set();
  const ids = new Set();
  const normalized = value.filter((item) => item && typeof item === 'object').map((item, index) => {
    if (item.type === 'separator') {
      let id = boundedString(item.id, 120) || `separator-${Date.now()}-${index}`;
      if (ids.has(id)) id = `separator-${Date.now()}-${index}`;
      ids.add(id);
      return { id, type: 'separator', name: '分隔线' };
    }
    const target = safeTarget(item.target);
    const name = boundedString(item.name, 40);
    const placeholder = allowPlaceholders && item.target === '' && defaults.some(entry => entry.id === item.id);
    if ((!target && !placeholder) || !name) return null;
    const key = target ? targetKey(target) : `placeholder:${item.id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    let id = boundedString(item.id, 120) || `restored-${Date.now()}-${index}`;
    if (ids.has(id)) id = `restored-${Date.now()}-${index}`;
    ids.add(id);
    return {
      id,
      name, target, glyph: boundedString(item.glyph || name, 4),
      color: allowedColors.has(item.color) ? item.color : 'blue', pinned: true,
      // Pre-v2 native PNG caches lost alpha. Re-read them without removing pins.
      ...(item.iconVersion === 2 && typeof item.icon === 'string' && item.icon.length <= 128 * 1024 && /^data:image\/png;base64,[a-z\d+/=]+$/i.test(item.icon) ? { icon: item.icon, iconVersion: 2 } : {}),
      ...(typeof item.collectedFrom === 'string' && safeTarget(item.collectedFrom) ? { collectedFrom: safeTarget(item.collectedFrom) } : {}),
    };
  }).filter(Boolean);
  return normalized.slice(0, limit);
}

function normalizeSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = { ...defaultSettings };
  for (const key of ['autoHide', 'launch', 'magnify', 'systemInfo', 'lyricsBar', 'lyricsAutoPlay', 'showRecycleBin', 'runningIndicators', 'hideOnFullscreen']) result[key] = source[key] === undefined ? defaultSettings[key] : source[key] === true;
  result.theme = allowedThemes.has(source.theme) ? source.theme : defaultSettings.theme;
  for (const key of ['lyricsTitle', 'lyricsArtist']) result[key] = boundedString(source[key], 80);
  result.lyricsText = typeof source.lyricsText === 'string' ? source.lyricsText.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, 4000) : '';
  result.lyricsInterval = Math.max(1, Math.min(12, Number(source.lyricsInterval) || defaultSettings.lyricsInterval));
  for (const [key, min, max] of [['glassRadius', 8, 40], ['glassOpacity', 10, 75], ['glassBlur', 0, 48], ['glassHighlight', 0, 100], ['glassShadow', 0, 60], ['iconSize', 40, 72], ['dockWidth', 40, 100]]) {
    const number = Number(source[key]);
    result[key] = Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : defaultSettings[key];
  }
  result.accentColor = typeof source.accentColor === 'string' && /^#[a-f\d]{6}$/i.test(source.accentColor) ? source.accentColor.toUpperCase() : defaultSettings.accentColor;
  return result;
}

function normalizeRecent(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    const target = safeTarget(item.target);
    const name = boundedString(item.name, 40) || targetName(target);
    if (!target) return null;
    const key = targetKey(target);
    if (seen.has(key)) return null;
    seen.add(key);
    return { id: boundedString(item.id, 120) || `recent-${index}`, name, target };
  }).filter(Boolean).slice(0, 20);
}

function mergeItemChanges(base, current, desired) {
  const original = new Map(base.map(item => [item.id, item]));
  const next = new Map(desired.map(item => [item.id, item]));
  const merged = new Map(current.map(item => [item.id, item]));
  for (const id of original.keys()) if (!next.has(id)) merged.delete(id);
  for (const item of desired) {
    if (!original.has(item.id) || JSON.stringify(original.get(item.id)) !== JSON.stringify(item)) merged.set(item.id, item);
  }
  const originalOrder = base.filter(item => next.has(item.id)).map(item => item.id);
  const desiredOrder = desired.filter(item => original.has(item.id)).map(item => item.id);
  const reordered = JSON.stringify(originalOrder) !== JSON.stringify(desiredOrder);
  const order = [...new Set([...(reordered ? desired : current).map(item => item.id), ...desired.map(item => item.id), ...current.map(item => item.id)])];
  const ordered = order.filter(id => merged.has(id)).map(id => merged.get(id));
  const collectedSources = new Set(ordered.filter(item => item.collectedFrom).map(item => targetKey(item.collectedFrom)));
  const seen = new Set();
  return ordered.filter(item => {
    if (!item.target || item.type === 'separator') return true;
    const key = targetKey(item.target);
    if (seen.has(key) || (collectedSources.has(key) && !item.collectedFrom)) return false;
    seen.add(key); return true;
  });
}

let items = normalizeItems(readJSON(STORAGE_KEY, defaults), defaults, true);
let settings = normalizeSettings(readJSON(SETTINGS_KEY, defaultSettings));
const storedDismissedTargets = readJSON(DISMISSED_KEY, []);
let dismissedTargets = new Set(Array.isArray(storedDismissedTargets) ? storedDismissedTargets.map(safeTarget).filter(Boolean).slice(0, 500) : []);
let recentItems = normalizeRecent(readJSON(RECENT_KEY, []));
let libraryItems = normalizeItems(readJSON(LIBRARY_KEY, []), [], false, 2000);
let savedSettings = { ...settings };
const savedState = new Map([
  [STORAGE_KEY, JSON.stringify(items)], [SETTINGS_KEY, JSON.stringify(settings)],
  [DISMISSED_KEY, JSON.stringify([...dismissedTargets].slice(0, 500))], [RECENT_KEY, JSON.stringify(recentItems)],
  [LIBRARY_KEY, JSON.stringify(libraryItems)],
]);
let desktopScanPending = null;

const dockRow = document.querySelector('#dockRow');
const customIconStore = window.customIconStore = window.customIcons.createStore(localStorage);
const isSettingsWindow = new URLSearchParams(location.search).get('view') === 'settings';
document.body.classList.toggle('settings-window', isSettingsWindow);
const dockShell = document.querySelector('.dock-shell');
const dropHint = document.querySelector('#dropHint');
const manageList = document.querySelector('#manageList');
const statusCopy = document.querySelector('#statusCopy');
const settingsPanel = document.querySelector('#settingsPanel');
const addDialog = document.querySelector('#addDialog');
const toast = document.querySelector('#toast');
const systemTime = document.querySelector('#systemTime');
const batteryStatus = document.querySelector('#batteryStatus');
const lyricsStatus = document.querySelector('#lyricsStatus');
const lyricsMeta = document.querySelector('#lyricsMeta');
const lyricsLine = document.querySelector('#lyricsLine');
const lyricsToggle = document.querySelector('#lyricsToggle');
const lyricsConfig = document.querySelector('#lyricsConfig');
const lyricsDialog = document.querySelector('#lyricsDialog');
const lyricsForm = document.querySelector('#lyricsForm');
let lyricsTimer;
let lyricsIndex = 0;
let timeTimer;
let batteryTimer;
let batteryPending = false;
const themeSelect = document.querySelector('#themeSelect');
const systemTheme = window.matchMedia?.('(prefers-color-scheme: light)');
let runningTargets = new Set();
let runningTimer;
let runningLaunchTimer;
let runningPending = false;
let runningGeneration = 0;
let nativeVisible = true;
function collapsedHeight() { return Math.round(188 + (settings.iconSize - 64) * 1.7); }
function persistPreferences() {
  return writeSharedState([[SETTINGS_KEY, JSON.stringify(settings)]]);
}
function applyDockPreferences() {
  const root = document.documentElement.style;
  root.setProperty('--icon-size', `${settings.iconSize}px`);
  root.setProperty('--row-height', `${collapsedHeight() - 24}px`);
  root.setProperty('--shelf-top', `${collapsedHeight() - 116 - (settings.iconSize - 64)}px`);
  root.setProperty('--primary', settings.accentColor);
  root.setProperty('--accent', settings.accentColor);
  const rgb = settings.accentColor.slice(1).match(/../g).map(n => parseInt(n, 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  root.setProperty('--on-primary', rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#111111' : '#ffffff');
  if (!isSettingsWindow) void window.dockAPI?.setLayout?.({ iconSize: settings.iconSize, dockWidth: settings.dockWidth });
}
function syncPreferenceControls() {
  for (const [id, unit] of [['iconSize', 'px'], ['dockWidth', '%']]) {
    document.querySelector(`#${id}`).value = settings[id];
    document.querySelector(`#${id}Value`).textContent = `${settings[id]}${unit}`;
  }
  document.querySelector('#accentColor').value = settings.accentColor;
  document.querySelectorAll('[data-accent]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.accent === settings.accentColor)));
  for (const key of ['runningIndicators', 'hideOnFullscreen']) document.querySelector(`#${key}Toggle`).checked = settings[key];
}
function paintRunningIndicators() {
  const byId = new Map(items.map(item => [item.id, item]));
  dockRow.querySelectorAll('.dock-item[data-id]').forEach(node => {
    const item = byId.get(node.dataset.id);
    const running = settings.runningIndicators && item?.type !== 'separator' && item?.target && runningTargets.has(targetKey(item.target));
    node.classList.toggle('is-running', Boolean(running));
    const button = node.querySelector('.dock-icon');
    if (button) button.setAttribute('aria-label', `打开 ${item.name}${running ? '，正在运行' : ''}`);
  });
}
function canRefreshRunning() {
  return !isSettingsWindow && settings.runningIndicators && nativeVisible && !document.hidden && !settingsPanel.classList.contains('is-open') && document.querySelector('#launcherPanel').hidden;
}
async function refreshRunningIndicators(refresh = false) {
  if (!canRefreshRunning() || runningPending || !window.dockAPI?.getRunningTargets) return;
  runningPending = true;
  const generation = runningGeneration;
  const targets = items.filter(item => item.type !== 'separator' && item.target).map(item => item.target);
  try {
    const result = await window.dockAPI.getRunningTargets(targets, refresh === true);
    if (generation === runningGeneration && canRefreshRunning()) runningTargets = new Set((result?.targets || []).filter(target => typeof target === 'string').map(targetKey));
  } catch { if (generation === runningGeneration) runningTargets.clear(); }
  finally { runningPending = false; paintRunningIndicators(); }
}
function syncRunningTimer() {
  clearInterval(runningTimer);
  runningTimer = null;
  runningGeneration++;
  if (!canRefreshRunning()) {
    clearTimeout(runningLaunchTimer);
    if (!settings.runningIndicators) { runningTargets.clear(); paintRunningIndicators(); }
    return;
  }
  void refreshRunningIndicators();
  if (window.dockAPI?.getRunningTargets) runningTimer = setInterval(() => void refreshRunningIndicators(), 12000);
}
const glassControls = [
  ['glassRadius', 'glassRadiusValue', 'px'],
  ['glassOpacity', 'glassOpacityValue', '%'],
  ['glassBlur', 'glassBlurValue', 'px'],
  ['glassHighlight', 'glassHighlightValue', '%'],
  ['glassShadow', 'glassShadowValue', '%'],
];

function applyGlassSettings() {
  const shell = document.querySelector('.dock-shell');
  const highlight = settings.glassHighlight / 100;
  const values = {
    '--dock-radius': `${Math.max(8, Math.min(40, Number(settings.glassRadius) || 22))}px`,
    '--dock-opacity': `${Math.max(10, Math.min(75, Number(settings.glassOpacity) || 35)) / 100}`,
    '--dock-blur': `${settings.glassBlur}px`,
    '--dock-highlight': `${highlight}`,
    '--dock-highlight-low': `${highlight * 0.3}`,
    '--dock-highlight-edge': `${highlight * 0.4}`,
    '--dock-shadow-opacity': `${settings.glassShadow / 100}`,
  };
  Object.entries(values).forEach(([name, value]) => shell.style.setProperty(name, value));
}

glassControls.forEach(([id, outputId, unit]) => {
  const input = document.querySelector(`#${id}`);
  const output = document.querySelector(`#${outputId}`);
  input.value = Number(settings[id]);
  output.textContent = `${input.value}${unit}`;
  input.addEventListener('input', () => {
    settings[id] = Number(input.value);
    output.textContent = `${input.value}${unit}`;
    applyGlassSettings();
    persistPreferences();
  });
});
applyGlassSettings();

function applyTheme() {
  const theme = settings.theme === 'system' ? (systemTheme?.matches ? 'light' : 'dark') : settings.theme;
  document.documentElement.dataset.theme = theme;
}

themeSelect.value = ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'dark';
applyTheme();
themeSelect.addEventListener('change', () => {
  settings.theme = themeSelect.value;
  applyTheme();
  persistPreferences();
});
systemTheme?.addEventListener?.('change', () => {
  if (settings.theme === 'system') applyTheme();
});

function updateSystemTime() {
  const now = new Date();
  systemTime.dateTime = now.toISOString();
  systemTime.textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}

function lyricsLines() {
  return String(settings.lyricsText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function renderLyrics({ reset = false } = {}) {
  const lines = lyricsLines();
  if (reset || lyricsIndex >= lines.length) lyricsIndex = 0;
  const hasLyrics = Boolean(settings.lyricsBar && lines.length);
  lyricsStatus.hidden = !hasLyrics;
  lyricsMeta.textContent = [settings.lyricsTitle, settings.lyricsArtist].filter(Boolean).join(' · ');
  lyricsMeta.hidden = !lyricsMeta.textContent;
  lyricsLine.textContent = lines[lyricsIndex] || '在设置中添加歌词';
  lyricsStatus.title = settings.lyricsTitle ? `${settings.lyricsTitle}${settings.lyricsArtist ? ` · ${settings.lyricsArtist}` : ''}` : '状态栏歌词';
  document.querySelector('.dock-shell').classList.toggle('has-lyrics', hasLyrics);
  clearInterval(lyricsTimer);
  lyricsTimer = null;
  if (!isSettingsWindow && hasLyrics && nativeVisible && !document.hidden && settings.lyricsAutoPlay && lines.length > 1) {
    lyricsTimer = setInterval(() => {
      lyricsIndex = (lyricsIndex + 1) % lines.length;
      lyricsLine.classList.remove('is-changing');
      requestAnimationFrame(() => {
        lyricsLine.classList.add('is-changing');
        lyricsLine.textContent = lines[lyricsIndex];
      });
    }, Math.max(1, Number(settings.lyricsInterval) || 4) * 1000);
  }
}

lyricsStatus.addEventListener('click', () => {
  openLyricsDialog();
});

function openLyricsDialog() {
  const form = lyricsForm;
  form.elements.title.value = settings.lyricsTitle || '';
  form.elements.artist.value = settings.lyricsArtist || '';
  form.elements.lyrics.value = settings.lyricsText || '';
  form.elements.autoPlay.checked = settings.lyricsAutoPlay !== false;
  form.elements.interval.value = Math.max(1, Math.min(12, Number(settings.lyricsInterval) || 4));
  document.querySelector('#lyricsIntervalValue').textContent = `${form.elements.interval.value} 秒`;
  document.querySelector('#lyricsError').textContent = '';
  lyricsDialog.showModal();
}

document.querySelector('#editLyricsButton').addEventListener('click', openLyricsDialog);
document.querySelector('#closeLyricsButton').addEventListener('click', () => lyricsDialog.close());
document.querySelector('#cancelLyricsButton').addEventListener('click', () => lyricsDialog.close());
document.querySelector('#lyricsInterval').addEventListener('input', (event) => {
  document.querySelector('#lyricsIntervalValue').textContent = `${event.currentTarget.value} 秒`;
});
lyricsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(lyricsForm);
  const text = String(data.get('lyrics') || '').trim();
  if (!text) {
    document.querySelector('#lyricsError').textContent = '请先输入至少一行歌词';
    return;
  }
  settings.lyricsTitle = String(data.get('title') || '').trim();
  settings.lyricsArtist = String(data.get('artist') || '').trim();
  settings.lyricsText = text;
  settings.lyricsAutoPlay = data.get('autoPlay') === 'on';
  settings.lyricsInterval = Number(data.get('interval')) || 4;
  lyricsIndex = 0;
  persistPreferences();
  renderLyrics({ reset: true });
  lyricsDialog.close();
  showToast('状态栏歌词已保存');
});

function renderBattery(battery) {
  if (!battery || !Number.isFinite(battery.level)) {
    batteryStatus.hidden = true;
    return;
  }
  batteryStatus.hidden = false;
  batteryStatus.style.setProperty('--battery-level', `${Math.max(0, Math.min(100, battery.level))}%`);
  batteryStatus.classList.toggle('charging', Boolean(battery.charging));
  batteryStatus.title = battery.charging ? `电量 ${battery.level}% · 正在充电` : `电量 ${battery.level}%`;
  batteryStatus.setAttribute('aria-label', batteryStatus.title);
  batteryStatus.textContent = `${battery.level}%`;
}

async function refreshBattery() {
  if (isSettingsWindow || !settings.systemInfo || !nativeVisible || document.hidden || batteryPending || !window.dockAPI?.getBattery) return;
  batteryPending = true;
  try {
    const battery = await window.dockAPI.getBattery();
    if (settings.systemInfo && nativeVisible && !document.hidden) renderBattery(battery);
  } catch { renderBattery(null); }
  finally { batteryPending = false; }
}

function syncSystemInfoTimers() {
  clearInterval(timeTimer);
  clearInterval(batteryTimer);
  timeTimer = null;
  batteryTimer = null;
  if (isSettingsWindow || !settings.systemInfo || !nativeVisible || document.hidden) {
    batteryStatus.hidden = true;
    return;
  }
  updateSystemTime();
  timeTimer = setInterval(updateSystemTime, 30_000);
  void refreshBattery();
  batteryTimer = setInterval(() => void refreshBattery(), 60_000);
}

syncSystemInfoTimers();
document.addEventListener('visibilitychange', () => {
  syncSystemInfoTimers();
  renderLyrics();
});
window.addEventListener('beforeunload', () => {
  clearInterval(timeTimer);
  clearInterval(batteryTimer);
  clearInterval(lyricsTimer);
});
document.querySelector('#soundStatus').addEventListener('click', () => void window.dockAPI?.openTarget?.('ms-settings:sound'));

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

function writeSharedState(updates) {
  const written = [];
  try {
    for (let [key, value] of updates) {
      // A launch in the Dock must not overwrite a slider in the settings window.
      // Only persist fields this renderer actually edited since its last sync.
      if (savedState.get(key) === value) continue;
      if (key === SETTINGS_KEY) {
        const merged = normalizeSettings(readJSON(SETTINGS_KEY, defaultSettings));
        for (const name of Object.keys(settings)) if (settings[name] !== savedSettings[name]) merged[name] = settings[name];
        settings = merged;
        value = JSON.stringify(settings);
      }
      if (key === STORAGE_KEY) {
        const base = JSON.parse(savedState.get(key));
        const current = normalizeItems(readJSON(key, base), base, true);
        const merged = mergeItemChanges(base, current, items);
        if (merged.length > 500) throw new Error('Dock capacity exceeded');
        items = merged;
        value = JSON.stringify(items);
      }
      if (key === LIBRARY_KEY) {
        const base = JSON.parse(savedState.get(key));
        const current = normalizeItems(readJSON(key, base), base, false, 2000);
        const existingIds = new Set(base.map(item => item.id));
        const incomingIds = new Set(libraryItems.filter(item => !existingIds.has(item.id)).map(item => item.id));
        const merged = mergeItemChanges(base, current, libraryItems);
        libraryItems = normalizeItems([...merged.filter(item => incomingIds.has(item.id)), ...merged], [], false, 2000);
        value = JSON.stringify(libraryItems);
      }
      if (key === DISMISSED_KEY) {
        const base = new Set(JSON.parse(savedState.get(key)));
        const current = readJSON(key, []);
        const merged = new Set(Array.isArray(current) ? current : []);
        for (const target of base) if (!dismissedTargets.has(target)) merged.delete(target);
        for (const target of dismissedTargets) if (!base.has(target)) merged.add(target);
        dismissedTargets = new Set([...merged].slice(0, 500));
        value = JSON.stringify([...dismissedTargets]);
      }
      const previous = localStorage.getItem(key);
      localStorage.setItem(key, value);
      written.push([key, previous, value]);
    }
    for (const [key, , value] of written) savedState.set(key, value);
    savedSettings = { ...settings };
    return true;
  } catch {
    for (const [key, previous] of written.reverse()) {
      try {
        if (previous === null) localStorage.removeItem(key);
        else localStorage.setItem(key, previous);
      } catch { /* Storage may remain unavailable; never acknowledge an import. */ }
    }
    statusCopy.textContent = '本地配置保存失败';
    showToast('本地配置保存失败，空间不足或数据无效');
    return false;
  }
}

function save() {
  if (items.length > 500) { showToast('程序坞最多容纳 500 个入口，请先移除一些入口'); return false; }
  const result = writeSharedState([
    [STORAGE_KEY, JSON.stringify(items)], [SETTINGS_KEY, JSON.stringify(settings)],
    [DISMISSED_KEY, JSON.stringify([...dismissedTargets].slice(0, 500))],
    [RECENT_KEY, JSON.stringify(recentItems.slice(0, 20))],
    [LIBRARY_KEY, JSON.stringify(libraryItems)],
  ]);
  if (result) statusCopy.textContent = `已固定 ${items.filter(item => item.type !== 'separator').length} 个应用`;
  return result;
}

function recordRecent(item) {
  if (!item?.target) return;
  const key = targetKey(item.target);
  recentItems = normalizeRecent([{ ...item, target: item.target }, ...recentItems.filter((entry) => targetKey(entry.target) !== key)]);
  writeSharedState([[RECENT_KEY, JSON.stringify(recentItems)]]);
  clearTimeout(runningLaunchTimer);
  runningLaunchTimer = setTimeout(() => void refreshRunningIndicators(true), 1500);
}

function commitItems(nextItems, nextDismissed = dismissedTargets) {
  const previous = { items, dismissedTargets, libraryItems };
  const keptIds = new Set(nextItems.map(item => item.id));
  // Removing a fixed entry must retain a searchable entry in All Apps.
  libraryItems = normalizeItems([...items.filter(item => item.target && !keptIds.has(item.id)), ...libraryItems], [], false, 2000);
  items = nextItems;
  dismissedTargets = nextDismissed;
  if (save()) return true;
  ({ items, dismissedTargets, libraryItems } = previous);
  return false;
}

function targetName(target) {
  const normalized = String(target).replaceAll('\\', '/');
  const basename = normalized.split('/').filter(Boolean).at(-1) || target;
  return basename.replace(/\.(lnk|url|exe|bat|cmd|ps1)$/i, '').slice(0, 40) || '新入口';
}

function addDroppedTargets(paths) {
  const candidates = [...new Set(paths.map(safeTarget).filter(Boolean))];
  const nextDismissed = new Set(dismissedTargets);
  const existing = new Set(items.map((item) => targetKey(item.target)));
  const added = [];
  for (const target of candidates) {
    const key = targetKey(target);
    if (existing.has(key)) continue;
    existing.add(key);
    nextDismissed.delete(key);
    added.push({ id: `dropped-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: targetName(target), target, glyph: targetName(target).slice(0, 1).toUpperCase(), color: 'blue', pinned: true });
  }
  if (!added.length) {
    showToast('这些入口已经在程序坞中');
    return 0;
  }
  if (!commitItems([...items, ...added], nextDismissed)) return 0;
  renderDock();
  if (settingsPanel.classList.contains('is-open')) renderManageList();
  showToast(`已添加 ${added.length} 个入口`);
  return added.length;
}

function exportPayload() {
  customIconStore.sync();
  return { format: 'lume-dock-config', version: 1, exportedAt: new Date().toISOString(), items, settings, recentItems, libraryItems, customIcons: customIconStore.export(), dismissedTargets: [...dismissedTargets] };
}

async function exportConfig() {
  try {
    if (!window.dockAPI?.exportConfig) { showToast('请在 Lume Dock 应用中导出配置'); return; }
    const result = await window.dockAPI.exportConfig(exportPayload());
    if (result.ok) showToast('配置已导出');
    else if (!result.canceled) showToast(result.message || '导出配置失败');
  } catch { showToast('导出配置失败，请重试'); }
}

function validImportedItems(value) {
  if (!Array.isArray(value)) return [];
  return normalizeItems(value, []).map((item, index) => ({ ...item, id: `imported-${Date.now()}-${index}` }));
}

async function importConfig() {
  try {
    if (!window.dockAPI?.importConfig) { showToast('请在 Lume Dock 应用中导入配置'); return; }
    const result = await window.dockAPI.importConfig();
    if (!result.ok) { if (!result.canceled) showToast(result.message || '导入配置失败'); return; }
    const importedItems = validImportedItems(result.data?.items);
    const existing = new Set(items.map((item) => targetKey(item.target)));
    const fresh = importedItems.filter((item) => item.type === 'separator' || !existing.has(targetKey(item.target)));
    const previous = { items, settings, recentItems, dismissedTargets, libraryItems };
    const previousIcons = localStorage.getItem(window.customIcons.STORAGE_KEY);
    items = [...items, ...fresh].slice(0, 500);
    if (result.data?.settings && typeof result.data.settings === 'object' && !Array.isArray(result.data.settings)) settings = normalizeSettings({ ...settings, ...result.data.settings });
    if (Array.isArray(result.data?.dismissedTargets)) dismissedTargets = new Set(result.data.dismissedTargets.map(safeTarget).filter(Boolean).slice(0, 500));
    if (Array.isArray(result.data?.recentItems)) recentItems = normalizeRecent(result.data.recentItems);
    if (Array.isArray(result.data?.libraryItems)) libraryItems = normalizeItems([...libraryItems, ...result.data.libraryItems], [], false, 2000);
    let customIconsWritten = false;
    try {
      if (result.data?.customIcons !== undefined) { customIconStore.import(result.data.customIcons); customIconsWritten = true; }
      if (!save()) throw new Error('本地配置保存失败');
    } catch (failure) {
      ({ items, settings, recentItems, dismissedTargets, libraryItems } = previous);
      if (customIconsWritten) {
        if (previousIcons === null) localStorage.removeItem(window.customIcons.STORAGE_KEY);
        else localStorage.setItem(window.customIcons.STORAGE_KEY, previousIcons);
        customIconStore.sync();
      }
      showToast(failure.message || '导入配置失败');
      return;
    }
    themeSelect.value = ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'dark';
    applyTheme();
    applyGlassSettings();
    applyDockPreferences();
    syncPreferenceControls();
    void window.dockAPI?.setFullscreenHide?.(settings.hideOnFullscreen);
    for (const [id, outputId, unit] of glassControls) {
      document.querySelector(`#${id}`).value = settings[id];
      document.querySelector(`#${outputId}`).textContent = `${settings[id]}${unit}`;
    }
    for (const key of ['autoHide', 'launch', 'magnify', 'systemInfo']) {
      const toggle = document.querySelector(`#${key}Toggle`);
      if (toggle) toggle.checked = Boolean(settings[key]);
    }
    recycleBinToggle.checked = Boolean(settings.showRecycleBin);
    lyricsToggle.checked = Boolean(settings.lyricsBar);
    lyricsConfig.hidden = !settings.lyricsBar;
    renderLyrics({ reset: true });
    document.body.classList.toggle('no-magnify', !settings.magnify);
    dockShell.classList.toggle('system-info-disabled', !settings.systemInfo);
    void window.dockAPI?.setAutoHide?.(Boolean(settings.autoHide));
    void window.dockAPI?.setLoginItem?.(Boolean(settings.launch));
    syncSystemInfoTimers();
    renderDock();
    if (launcher.isOpen()) launcher.render({ preserveScroll: true });
    syncRunningTimer();
    if (settingsPanel.classList.contains('is-open')) renderManageList();
    showToast(`已导入配置，新增 ${fresh.length} 个入口`);
  } catch { showToast('导入配置失败，请重试'); }
}

document.querySelector('#exportConfigButton').addEventListener('click', () => void exportConfig());
document.querySelector('#importConfigButton').addEventListener('click', () => void importConfig());

function resetDropHint() {
  dockShell.classList.remove('is-drop-target');
  dropHint.hidden = true;
}
resetDropHint();
window.addEventListener('dragend', resetDropHint);
window.addEventListener('blur', resetDropHint);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetDropHint(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') resetDropHint(); });

dockShell.addEventListener('dragenter', (event) => {
  if (![...event.dataTransfer?.types || []].includes('Files')) return;
  event.preventDefault();
  dockShell.classList.add('is-drop-target');
  dropHint.hidden = false;
});
dockShell.addEventListener('dragover', (event) => {
  if (![...event.dataTransfer?.types || []].includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
dockShell.addEventListener('dragleave', (event) => {
  if (event.relatedTarget && dockShell.contains(event.relatedTarget)) return;
  dockShell.classList.remove('is-drop-target');
  dropHint.hidden = true;
});
dockShell.addEventListener('drop', (event) => {
  resetDropHint();
  if (![...event.dataTransfer?.types || []].includes('Files')) return;
  event.preventDefault();
  const paths = [...(event.dataTransfer?.files || [])].map((file) => window.dockAPI?.getPathForFile?.(file) || file.path || '').filter(Boolean);
  addDroppedTargets(paths);
});

function iconContent(item) {
  const icon = window.dockIcons.preferred(item) || window.dockIcons.fallback(item);
  return `<img src="${escapeHtml(icon)}" alt="" draggable="false" />`;
}

function stylesFor(item) {
  const [bg, fg] = colorMap[item.color] || colorMap.amber;
  return `--icon-bg:${bg};--icon-color:${fg};`;
}

function renderDock() {
  if (isSettingsWindow) return;
  dockRow.innerHTML = `<article class="dock-item launcher-dock-item">
    <button class="dock-icon" id="appsButton" type="button" style="${stylesFor({ color: 'blue' })}" aria-label="打开全部应用" aria-controls="launcherPanel">${iconContent({ id: 'apps', name: '全部应用' })}</button>
    <span class="dock-label">全部应用</span>
  </article>` + (settings.showRecycleBin ? `<article class="dock-item recycle-bin-item" data-system-id="recycle-bin">
    <button class="dock-icon" id="recycleBinButton" type="button" aria-label="打开回收站">${iconContent({ id: 'recycle-bin', name: '回收站' })}</button>
    <span class="dock-label">回收站</span>
  </article>` : '') + items.map((item) => item.type === 'separator' ? `<article class="dock-item dock-separator" data-id="${escapeHtml(item.id)}" role="separator" aria-label="分隔线"><span></span></article>` : `<article class="dock-item " data-id="${escapeHtml(item.id)}">
    <button class="dock-icon" style="${stylesFor(item)}" type="button" aria-label="打开 ${escapeHtml(item.name)}">${iconContent(item)}</button>
    <span class="dock-label">${escapeHtml(item.name)}</span>
  </article>`).join('') + `<article class="dock-item dock-footer"><button class="dock-icon" id="settingsButton" type="button" aria-label="打开设置">${iconContent({id:'settings',name:'设置'})}</button><span class="dock-label">设置</span></article>`;
  dockMotion.refresh();
  paintRunningIndicators();
  const byId = new Map(items.map(item => [item.id, item]));
  dockRow.querySelectorAll('.dock-item[data-id]').forEach((article) => {
    const item = byId.get(article.dataset.id);
    if (!item?.target || window.dockIcons.preferred(item) || !window.dockAPI?.getIcon) return;
    window.dockAPI.getIcon(item.target).then((icon) => {
      if (!icon || !article.isConnected || customIconStore.get(item)) return;
      const iconButton = article.querySelector('.dock-icon');
      iconButton.innerHTML = `<img src="${icon}" alt="" />`;
    }).catch(() => {});
  });
}

// Keep one set of handlers as the Dock is rebuilt after edits.
dockRow.addEventListener('click', event => {
  const button = event.target.closest('.dock-icon');
  if (!button) return;
  if (button.id === 'appsButton') void launcher.open();
  else if (button.id === 'settingsButton') openSettings();
  else if (button.id === 'recycleBinButton') void window.dockAPI?.openRecycleBin?.();
  else void openItem(button.closest('.dock-item').dataset.id);
});
dockRow.addEventListener('contextmenu', event => {
  const article = event.target.closest('.dock-item');
  if (!article || article.classList.contains('dock-separator')) return;
  event.preventDefault();
  if (article.dataset.systemId === 'recycle-bin') { void emptyRecycleBin(); return; }
  const builtin = article.querySelector('#appsButton') ? { id: 'apps', name: '全部应用' } :
    article.querySelector('#settingsButton') ? { id: 'settings', name: '设置' } : null;
  void iconEditor.open(builtin || items.find(item => item.id === article.dataset.id));
});

async function emptyRecycleBin() {
  if (!window.dockAPI?.emptyRecycleBin) { showToast('请在 Windows 应用中使用此功能'); return; }
  try {
    const result = await window.dockAPI.emptyRecycleBin();
    if (!result.ok) showToast(result.canceled ? '已取消清空' : result.message || '清空回收站失败');
    else showToast('回收站已清空');
  } catch { showToast('清空回收站失败，请重试'); }
}

function renderManageList() {
  const byId = new Map(items.map(item => [item.id, item]));
  manageList.innerHTML = items.map((item) => `<div class="manage-item" draggable="true" data-id="${escapeHtml(item.id)}">
    <div class="manage-left"><span class="manage-icon" style="${stylesFor(item)}">${item.type === 'separator' ? '│' : iconContent(item)}</span><div class="manage-name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.type === 'separator' ? '拖动调整分组位置' : item.target || '等待设置打开位置')}</small></div></div>
    <div class="manage-actions">${item.type !== 'separator' ? `<button class="change-icon" type="button" aria-label="更换 ${escapeHtml(item.name)} 的图标">图标</button>` : ''}<button class="remove-item" type="button" aria-label="移除 ${escapeHtml(item.name)}">×</button></div>
  </div>`).join('');
  manageList.querySelectorAll('.change-icon').forEach(button => button.addEventListener('click', () => {
    void iconEditor.open(items.find(item => item.id === button.closest('.manage-item').dataset.id));
  }));
  manageList.querySelectorAll('.remove-item').forEach((button) => button.addEventListener('click', () => {
    const id = button.closest('.manage-item').dataset.id;
    const removed = items.find((item) => item.id === id);
    const nextDismissed = new Set(dismissedTargets);
    if (removed?.target) nextDismissed.add(targetKey(removed.target));
    if (!commitItems(items.filter((item) => item.id !== id), nextDismissed)) return;
    renderDock(); renderManageList(); showToast(`已移除 ${removed?.name || '快捷方式'}`);
  }));
  manageList.querySelectorAll('.manage-item').forEach((row) => {
    const item = byId.get(row.dataset.id);
    if (window.dockIcons.preferred(item)) return;
    if (!item?.target || !window.dockAPI?.getIcon) return;
    window.dockAPI.getIcon(item.target).then((icon) => {
      if (!icon || !row.isConnected || customIconStore.get(item)) return;
      row.querySelector('.manage-icon').innerHTML = `<img src="${icon}" alt="" />`;
    }).catch(() => {});
  });
  manageList.querySelectorAll('.manage-item').forEach((row) => {
    row.addEventListener('dragstart', () => row.classList.add('dragging'));
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      const order = [...manageList.querySelectorAll('.manage-item')].map((node) => node.dataset.id);
      commitItems(order.map(id => byId.get(id)).filter(Boolean));
      renderDock(); renderManageList();
    });
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      const dragging = manageList.querySelector('.dragging');
      if (!dragging || dragging === row) return;
      const rect = row.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      manageList.insertBefore(dragging, after ? row.nextSibling : row);
    });
  });
}

async function openItem(id) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item || item.type === 'separator') return;
  if (!item.target) { openSettings(); showToast(`请先为“${item.name}”设置打开位置`); return; }
  if (!window.dockAPI?.openTarget) { showToast('请在 Electron 应用中打开快捷方式'); return; }
  try {
    const result = await window.dockAPI.openTarget(item.target);
    if (!result.ok) showToast(result.message || '暂时无法打开这个位置');
    else recordRecent(item);
  } catch { showToast('暂时无法打开这个位置，请重试'); }
}

function openSettings() {
  if (!isSettingsWindow && window.dockAPI?.openSettings) {
    launcher.close(false);
    window.dockAPI.setHeight(collapsedHeight());
    return window.dockAPI.openSettings();
  }
  launcher.close(false);
  settingsPanel.inert = false;
  window.dockAPI?.setHeight?.(600);
  settingsPanel.classList.add('is-open');
  syncRunningTimer();
  settingsPanel.setAttribute('aria-hidden', 'false');
  renderManageList();
  void loadIntegrationStatus();
}

function closeSettings() {
  if (isSettingsWindow) return window.dockAPI?.closeSettings?.();
  settingsPanel.inert = true;
  settingsPanel.classList.remove('is-open');
  settingsPanel.setAttribute('aria-hidden', 'true');
  window.dockAPI?.setHeight?.(collapsedHeight());
  syncRunningTimer();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

document.querySelector('#closeSettings').addEventListener('click', closeSettings);
window.dockAPI?.onTrayOpenSettings?.(() => openSettings());
window.dockAPI?.onTrayAutoHide?.((enabled) => {
  settings.autoHide = enabled;
  const toggle = document.querySelector('#autoHideToggle');
  toggle.checked = enabled;
  void window.dockAPI?.setAutoHide?.(enabled);
  persistPreferences();
});
function openAddDialog() {
  document.querySelector('#addForm').reset();
  document.querySelector('#addError').textContent = '';
  addDialog.showModal();
}
document.querySelector('#addButton').addEventListener('click', openAddDialog);
function targetKey(target) {
  const text = String(target).trim();
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(text) ? text.replaceAll('/', '\\').toLowerCase() : text;
}

async function scanDesktop({ automatic = false } = {}) {
  if (desktopScanPending) return desktopScanPending;
  if (!window.dockAPI?.scanDesktop) {
    if (!automatic) showToast('请在程序坞应用中扫描桌面');
    return;
  }
  const button = document.querySelector('#importButton');
  button.disabled = true;
  button.textContent = '正在扫描…';
  desktopScanPending = (async () => {
    try {
      const result = await window.dockAPI.scanDesktop();
      const existing = new Set([...libraryItems, ...items].flatMap((item) => [targetKey(item.target), ...(item.collectedFrom ? [targetKey(item.collectedFrom)] : [])]));
      const freshItems = [];
      for (const item of result.items || []) {
        const key = targetKey(item.target);
        if (!safeTarget(item.target) || existing.has(key)) continue;
        existing.add(key);
        freshItems.push({ ...item, id: `desktop-${Date.now()}-${Math.random().toString(16).slice(2)}` });
      }
      if (freshItems.length) {
        const previous = libraryItems;
        libraryItems = normalizeItems([...libraryItems, ...freshItems], [], false, 2000);
        if (!writeSharedState([[LIBRARY_KEY, JSON.stringify(libraryItems)]])) { libraryItems = previous; return; }
        if (launcher.isOpen()) launcher.render();
        showToast(`已收录 ${freshItems.length} 个桌面入口到全部应用${result.warnings?.length ? '，部分桌面未能读取' : ''}`);
      } else if (result.error || result.warnings?.length) {
        showToast('部分桌面无法读取，可重新扫描或手动添加');
      } else if (!automatic) {
        showToast('桌面入口已收录到全部应用，点击星号可固定到程序坞');
      }
    } catch {
      showToast('桌面扫描失败，可稍后重新扫描或手动添加');
    } finally {
      desktopScanPending = null;
      button.disabled = false;
      button.textContent = '重新扫描桌面';
    }
  })();
  return desktopScanPending;
}

document.querySelector('#importButton').addEventListener('click', () => void scanDesktop());

async function pickTarget(kind) {
  const errorCopy = document.querySelector('#addError');
  errorCopy.textContent = '';
  if (!window.dockAPI?.pickTarget) { errorCopy.textContent = '请在程序坞应用中选择文件，也可直接输入路径'; return; }
  const buttons = document.querySelectorAll('.target-picker button');
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const result = await window.dockAPI.pickTarget(kind);
    if (result.error) { errorCopy.textContent = '无法选择文件，请直接输入路径'; return; }
    if (result.canceled) return;
    const form = document.querySelector('#addForm');
    form.elements.target.value = result.target;
    if (!form.elements.name.value.trim()) form.elements.name.value = result.name.slice(0, 20);
  } catch {
    errorCopy.textContent = '无法选择文件，请直接输入路径';
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}
document.querySelector('#pickFileButton').addEventListener('click', () => void pickTarget('file'));
document.querySelector('#pickFolderButton').addEventListener('click', () => void pickTarget('folder'));
document.querySelector('#quitButton').addEventListener('click', () => window.dockAPI?.quit?.());

document.querySelector('#addForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const name = boundedString(String(data.get('name') || ''), 40);
  const target = safeTarget(String(data.get('target') || ''));
  if (/^(?:javascript|data|vbscript):/i.test(String(data.get('target') || '').trim())) {
    document.querySelector('#addError').textContent = '不支持此类脚本或数据链接';
    return;
  }
  if (!name || !target) return;
  if (items.some((item) => targetKey(item.target) === targetKey(target))) {
    document.querySelector('#addError').textContent = '这个入口已在程序坞中';
    return;
  }
  const nextDismissed = new Set(dismissedTargets);
  nextDismissed.delete(targetKey(target));
  const added = { id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`, name, target, glyph: String(data.get('glyph') || name.slice(0, 1)).trim(), color: String(data.get('color') || 'amber'), pinned: true };
  if (!commitItems([...items, added], nextDismissed)) return;
  renderDock(); renderManageList(); addDialog.close(); showToast(`已添加 ${name}`);
  if (launcher.isOpen()) launcher.render();
});

['autoHide', 'launch', 'magnify', 'systemInfo'].forEach((key) => {
  const toggle = document.querySelector(`#${key}Toggle`);
  toggle.checked = Boolean(settings[key]);
  toggle.addEventListener('change', async () => {
    settings[key] = toggle.checked;
    if (key === 'launch') await window.dockAPI?.setLoginItem?.(toggle.checked);
    if (key === 'autoHide') await window.dockAPI?.setAutoHide?.(toggle.checked);
    persistPreferences();
    if (key === 'magnify') {
      document.body.classList.toggle('no-magnify', !toggle.checked);
      dockMotion.reset();
    }
    if (key === 'systemInfo') {
      document.querySelector('.dock-shell').classList.toggle('system-info-disabled', !toggle.checked);
      syncSystemInfoTimers();
    }
  });
});

lyricsToggle.checked = Boolean(settings.lyricsBar);
lyricsConfig.hidden = !settings.lyricsBar;
lyricsToggle.addEventListener('change', () => {
  settings.lyricsBar = lyricsToggle.checked;
  lyricsConfig.hidden = !settings.lyricsBar;
  persistPreferences();
  renderLyrics({ reset: true });
  if (settings.lyricsBar && !lyricsLines().length) {
    openLyricsDialog();
    showToast('请先添加歌词内容');
  }
});

const recycleBinToggle = document.querySelector('#recycleBinToggle');
recycleBinToggle.checked = settings.showRecycleBin;
recycleBinToggle.addEventListener('change', () => {
  settings.showRecycleBin = recycleBinToggle.checked;
  persistPreferences();
  renderDock();
});

document.body.classList.toggle('no-magnify', !settings.magnify);
document.querySelector('.dock-shell').classList.toggle('system-info-disabled', !settings.systemInfo);
renderLyrics({ reset: true });
if (!isSettingsWindow) void window.dockAPI?.setAutoHide?.(Boolean(settings.autoHide));
async function hydrateDefaultTargets() {
  if (!window.dockAPI?.getDefaultTargets) return;
  const targetMap = await window.dockAPI.getDefaultTargets();
  let changed = false;
  items = items.map((item) => {
    const target = targetMap?.[item.id];
    if (!item.target && target) {
      changed = true;
      return { ...item, target };
    }
    return item;
  });
  if (changed) save();
  renderDock();
}

const launcher = window.createLauncher({
  getPinned: () => items, getLibrary: () => libraryItems, getRecent: () => recentItems, recordRecent, keyForTarget: targetKey, escape: escapeHtml,
  refreshLibrary: () => scanDesktop({ automatic: true }),
  editIcon: item => void iconEditor.open(item),
  notify: showToast, beforeOpen: () => { if (!isSettingsWindow) closeSettings(); }, openAdd: openAddDialog,
  restoreDock: () => { void window.dockAPI?.setHeight?.(collapsedHeight()); syncRunningTimer(); },
  addPinned: (item) => {
    if (items.some((pinned) => targetKey(pinned.target) === targetKey(item.target))) return false;
    try { customIconStore.link(item); } catch (error) { showToast(error.message); return false; }
    const added = { ...item, id: `pinned-${Date.now()}-${Math.random().toString(16).slice(2)}`, color: 'blue', glyph: item.name.slice(0, 1), pinned: true };
    const nextDismissed = new Set(dismissedTargets);
    nextDismissed.delete(targetKey(item.target));
    if (!commitItems([...items, added], nextDismissed)) return false;
    renderDock();
    showToast(`已固定 ${item.name}`);
    return true;
  },
  removePinned: (item) => {
    const key = targetKey(item.target);
    const aliases = new Set([key, ...(item.aliases || [])]);
    if (!items.some(entry => entry.type !== 'separator' && aliases.has(targetKey(entry.target)))) return false;
    const nextDismissed = new Set(dismissedTargets);
    for (const entry of items) if (aliases.has(targetKey(entry.target))) nextDismissed.add(targetKey(entry.target));
    if (!commitItems(items.filter(entry => entry.type === 'separator' || !aliases.has(targetKey(entry.target))), nextDismissed)) return false;
    renderDock();
    showToast(`已取消固定 ${item.name}，仍可在全部应用中找到`);
    return true;
  },
});
const iconEditor = window.createIconEditor({
  store: customIconStore, notify: showToast,
  changed: () => { renderDock(); if (settingsPanel.classList.contains('is-open')) renderManageList(); if (launcher.isOpen()) launcher.render({ preserveScroll: true }); },
  beforeOpen: async () => { if (!isSettingsWindow && !launcher.isOpen()) await window.dockAPI?.setHeight?.(600); },
  afterClose: () => {
    if (!isSettingsWindow && !launcher.isOpen() && !settingsPanel.classList.contains('is-open')) void window.dockAPI?.setHeight?.(collapsedHeight());
    if (launcher.isOpen()) document.querySelector('#appSearch').focus();
    else if (!isSettingsWindow) document.querySelector('#appsButton')?.focus();
  },
});
window.dockAPI?.onShortcutOpenLauncher?.(() => void launcher.open());
if (!isSettingsWindow) window.dockAPI?.onSettingsPreview?.(() => {
  launcher.close(false); dockMotion.reset(); syncRunningTimer();
});
const integrationToggle = document.querySelector('#desktopIntegrationToggle');
const integrationHint = document.querySelector('#desktopIntegrationHint');
async function loadIntegrationStatus() {
  if (!window.dockAPI?.integrationStatus) {
    integrationHint.textContent = '请在安装后的 Windows 版本中开启';
    return;
  }
  try {
    const result = await window.dockAPI.integrationStatus();
    integrationToggle.checked = result.enabled;
    integrationToggle.disabled = !result.supported;
    integrationHint.textContent = result.message || (result.supported ? '加入后移入回收站 · 菜单位于“显示更多选项”' : '请在安装后的 Windows 版本中开启');
  } catch { integrationHint.textContent = '设置读取失败，重新打开设置可重试'; }
}
integrationToggle.addEventListener('change', async () => {
  const desired = integrationToggle.checked;
  integrationToggle.disabled = true;
  try {
    const result = await window.dockAPI.setDesktopIntegration(desired);
    integrationToggle.checked = result.enabled;
    if (!result.ok) showToast(result.message || '右键菜单设置失败');
    else showToast(desired ? '已开启右键收纳，加入成功后桌面快捷方式会移入回收站' : '已关闭桌面右键菜单');
  } catch { integrationToggle.checked = !desired; showToast('右键菜单设置失败，请重试'); }
  finally { integrationToggle.disabled = false; }
});
let importPending = false;
let importAgain = false;
async function receiveDesktopImports() {
  if (!window.dockAPI?.pendingDesktopImports) return;
  if (importPending) { importAgain = true; return; }
  importPending = true;
  try {
    do {
      importAgain = false;
      const result = await window.dockAPI.pendingDesktopImports();
      if (result.error) showToast(result.error);
      for (const entry of result.items || []) {
        const oldItems = items;
        const oldDismissed = new Set(dismissedTargets);
        // Replace a previous auto-scan entry rather than adding a duplicate.
        const existing = items.find(item => targetKey(item.target) === targetKey(entry.source) || targetKey(item.target) === targetKey(entry.target) || (item.collectedFrom && targetKey(item.collectedFrom) === targetKey(entry.source)));
        const imported = { ...existing, id: existing?.id || `collected-${entry.id}`, name: entry.name,
          target: entry.target, collectedFrom: entry.source, pinned: true, color: 'blue' };
        items = items.filter(item => item !== existing && targetKey(item.target) !== targetKey(entry.source));
        items.push(imported);
        dismissedTargets.delete(targetKey(entry.source));
        if (!save()) { items = oldItems; dismissedTargets = oldDismissed; showToast('收纳保存失败，桌面快捷方式已保留'); break; }
        renderDock();
        if (settingsPanel.classList.contains('is-open')) renderManageList();
        if (launcher.isOpen()) launcher.render();
        const ack = await window.dockAPI.acknowledgeDesktopImport(entry.id);
        showToast(ack.ok ? ack.warning || `已收纳 ${entry.name}，桌面快捷方式已移入回收站` : ack.message || '已加入，桌面快捷方式已保留，请重启后重试');
      }
    } while (importAgain);
  } catch { showToast('收纳未完成，桌面快捷方式已保留，可重启程序重试'); }
  finally { importPending = false; }
}
if (!isSettingsWindow) window.dockAPI?.onDesktopImportsChanged(() => void receiveDesktopImports());
settingsPanel.inert = true;
const dockMotion = window.createDockMotion(dockRow);
if (!window.dockAPI) document.body.classList.add('browser-preview');
renderDock();
window.dockReady = (async () => {
  if (isSettingsWindow) { openSettings(); return; }
  // Earlier releases marked automatic scans with desktop-* IDs. Move only
  // those entries to the library; explicit pins/manual/collected entries stay.
  const legacyScans = items.filter(item => item.id.startsWith('desktop-') && !item.collectedFrom);
  if (legacyScans.length) {
    const legacyIds = new Set(legacyScans.map(item => item.id));
    if (commitItems(items.filter(item => !legacyIds.has(item.id)))) renderDock();
  }
  try { await hydrateDefaultTargets(); }
  catch { showToast('默认位置读取失败，可手动添加'); }
  await scanDesktop({ automatic: true });
  await loadIntegrationStatus();
  await receiveDesktopImports();
})();
// The launch preference is persisted in localStorage, while Windows startup
// is controlled by Electron. Sync it once when the renderer is ready.
if (!isSettingsWindow) void window.dockAPI?.setLoginItem?.(Boolean(settings.launch));

for (const id of ['iconSize', 'dockWidth']) {
  document.querySelector(`#${id}`).addEventListener('input', event => {
    settings[id] = Number(event.currentTarget.value);
    syncPreferenceControls(); applyDockPreferences(); persistPreferences(); dockMotion.refresh();
  });
}
function changeAccent(color) {
  settings.accentColor = normalizeSettings({ ...settings, accentColor: color }).accentColor;
  syncPreferenceControls(); applyDockPreferences(); persistPreferences();
}
document.querySelector('#accentColor').addEventListener('input', event => changeAccent(event.currentTarget.value));
document.querySelectorAll('[data-accent]').forEach(button => button.addEventListener('click', () => changeAccent(button.dataset.accent)));
document.querySelector('#resetDockSize').addEventListener('click', () => {
  settings.iconSize = defaultSettings.iconSize; settings.dockWidth = defaultSettings.dockWidth;
  syncPreferenceControls(); applyDockPreferences(); persistPreferences(); dockMotion.refresh();
});
document.querySelector('#addSeparator').addEventListener('click', () => {
  if (items.length >= 500) { showToast('最多可保存 500 个入口'); return; }
  if (!commitItems([...items, {id: `separator-${Date.now()}-${Math.random().toString(16).slice(2)}`, type: 'separator', name: '分隔线'}])) return;
  renderDock(); renderManageList();
});
for (const key of ['runningIndicators', 'hideOnFullscreen']) {
  document.querySelector(`#${key}Toggle`).addEventListener('change', event => {
    settings[key] = event.currentTarget.checked; persistPreferences();
    if (key === 'hideOnFullscreen') void window.dockAPI?.setFullscreenHide?.(settings[key]);
    syncRunningTimer();
  });
}
window.dockAPI?.onVisibilityChanged?.(visible => { nativeVisible = visible; dockMotion.setVisible(visible); syncRunningTimer(); syncSystemInfoTimers(); renderLyrics(); if (!visible) resetDropHint(); });
document.addEventListener('visibilitychange', syncRunningTimer);
new MutationObserver(syncRunningTimer).observe(document.querySelector('#launcherPanel'), {attributes: true, attributeFilter: ['hidden']});
window.addEventListener('beforeunload', () => { clearInterval(runningTimer); clearTimeout(runningLaunchTimer); });
applyDockPreferences(); syncPreferenceControls(); syncRunningTimer();
if (!isSettingsWindow) void window.dockAPI?.setFullscreenHide?.(settings.hideOnFullscreen);

// Both windows load the same local document and share its Storage partition.
// Storage events arrive only in the other renderer, so applying them never echoes writes.
let sharedStateTimer;
window.addEventListener('storage', event => {
  if (event.key !== null && !savedState.has(event.key) && event.key !== window.customIcons.STORAGE_KEY) return;
  clearTimeout(sharedStateTimer);
  sharedStateTimer = setTimeout(syncSharedState, 0);
});
function syncSharedState() {
  const iconsChanged = customIconStore.sync();
  const previous = settings;
  const incoming = normalizeSettings(readJSON(SETTINGS_KEY, defaultSettings));
  const dirty = Object.fromEntries(Object.keys(settings).filter(key => settings[key] !== savedSettings[key]).map(key => [key, settings[key]]));
  savedSettings = { ...incoming };
  savedState.set(SETTINGS_KEY, JSON.stringify(incoming));
  settings = { ...incoming, ...dirty };
  const incomingItems = normalizeItems(readJSON(STORAGE_KEY, defaults), defaults, true);
  const itemsJSON = JSON.stringify(incomingItems);
  const itemsChanged = itemsJSON !== savedState.get(STORAGE_KEY);
  if (itemsChanged) { items = incomingItems; savedState.set(STORAGE_KEY, itemsJSON); }
  const incomingDismissed = readJSON(DISMISSED_KEY, []);
  dismissedTargets = new Set(Array.isArray(incomingDismissed) ? incomingDismissed.map(safeTarget).filter(Boolean).slice(0, 500) : []);
  savedState.set(DISMISSED_KEY, JSON.stringify([...dismissedTargets]));
  const incomingRecent = normalizeRecent(readJSON(RECENT_KEY, []));
  const recentJSON = JSON.stringify(incomingRecent);
  const recentChanged = recentJSON !== savedState.get(RECENT_KEY);
  if (recentChanged) recentItems = incomingRecent;
  savedState.set(RECENT_KEY, recentJSON);
  const incomingLibrary = normalizeItems(readJSON(LIBRARY_KEY, []), [], false, 2000);
  const libraryJSON = JSON.stringify(incomingLibrary);
  const libraryChanged = libraryJSON !== savedState.get(LIBRARY_KEY);
  if (libraryChanged) libraryItems = incomingLibrary;
  savedState.set(LIBRARY_KEY, libraryJSON);
  syncPreferenceControls(); applyDockPreferences(); applyGlassSettings(); applyTheme();
  themeSelect.value = settings.theme;
  for (const [id, outputId, unit] of glassControls) {
    document.getElementById(id).value = settings[id];
    document.getElementById(outputId).textContent = `${settings[id]}${unit}`;
  }
  for (const key of ['autoHide', 'launch', 'magnify', 'systemInfo']) document.getElementById(`${key}Toggle`).checked = settings[key];
  recycleBinToggle.checked = settings.showRecycleBin;
  lyricsToggle.checked = settings.lyricsBar; lyricsConfig.hidden = !settings.lyricsBar;
  document.body.classList.toggle('no-magnify', !settings.magnify);
  dockShell.classList.toggle('system-info-disabled', !settings.systemInfo);
  if (itemsChanged || iconsChanged || previous.showRecycleBin !== settings.showRecycleBin) {
    renderDock();
    if (settingsPanel.classList.contains('is-open')) renderManageList();
  }
  if ((itemsChanged || libraryChanged || recentChanged || iconsChanged) && launcher.isOpen()) launcher.render({ preserveScroll: true });
  if (iconsChanged) iconEditor.refresh();
  if (itemsChanged || previous.runningIndicators !== settings.runningIndicators) syncRunningTimer();
  if (previous.systemInfo !== settings.systemInfo) syncSystemInfoTimers();
  if (Object.keys(settings).some(key => key.startsWith('lyrics') && settings[key] !== previous[key])) renderLyrics({ reset: true });
  if (!isSettingsWindow) {
    if (previous.hideOnFullscreen !== settings.hideOnFullscreen) void window.dockAPI?.setFullscreenHide?.(settings.hideOnFullscreen);
    if (previous.autoHide !== settings.autoHide) void window.dockAPI?.setAutoHide?.(settings.autoHide);
    if (previous.launch !== settings.launch) void window.dockAPI?.setLoginItem?.(settings.launch);
  }
  if (previous.iconSize !== settings.iconSize || previous.magnify !== settings.magnify) { dockMotion.reset(); dockMotion.refresh(); }
  statusCopy.textContent = `已固定 ${items.filter(item => item.type !== 'separator').length} 个应用`;
}
document.addEventListener('keydown', event => {
  if (isSettingsWindow && event.key === 'Escape' && !addDialog.open && !lyricsDialog.open && !document.querySelector('#iconDialog').open) closeSettings();
});
window.addEventListener('beforeunload', () => clearTimeout(sharedStateTimer));
