const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function config(saved = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8').split('const dockRow =')[0];
  const context = vm.createContext({ localStorage: { getItem: key => saved[key] || null }, readJSON(key, fallback) {
    try { return JSON.parse(saved[key]) ?? fallback; } catch { return fallback; }
  } });
  vm.runInContext(source + `\n${fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8').match(/function targetKey\(target\) \{[\s\S]*?\n\}/)[0]}\n${fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8').match(/function targetName\(target\) \{[\s\S]*?\n\}/)[0]}`, context);
  return expression => JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
}

test('corrupt stored types recover; defaults and intentionally empty docks survive validation', () => {
  assert.equal(config()('items.length'), 7);
  assert.equal(config({ 'lume-dock-items-v1': '[]' })('items.length'), 0);
  const read = config({ 'lume-dock-items-v1': '{}', 'lume-dock-settings-v1': 'null', 'lume-dock-dismissed-v1': '{}', 'lume-dock-recent-v1': '{}' });
  assert.equal(read('items.length'), 7);
  assert.equal(read('settings.magnify'), true);
  assert.equal(read('recentItems.length'), 0);
  assert.equal(read('dismissedTargets.size'), 0);
});

test('settings preserve multiline lyrics and zero effects while rejecting malformed fields', () => {
  const read = config();
  const result = read(`normalizeSettings({ lyricsText: '第一行\\n第二行', lyricsTitle: {}, glassBlur: 0, glassHighlight: 0, glassShadow: 0, glassRadius: 999, theme: 'broken', magnify: 'false', lyricsInterval: -2 })`);
  assert.equal(result.lyricsText, '第一行\n第二行');
  assert.equal(result.lyricsTitle, '');
  assert.equal(result.glassBlur, 0);
  assert.equal(result.glassHighlight, 0);
  assert.equal(result.glassShadow, 0);
  assert.equal(result.glassRadius, 40);
  assert.equal(result.theme, 'dark');
  assert.equal(result.magnify, false);
  assert.equal(result.lyricsInterval, 1);
});

test('malformed recent records, duplicate paths and executable data URLs are filtered', () => {
  const read = config();
  assert.equal(read(`normalizeRecent([null, {target:'C:\\\\Tools\\\\App.exe'}, {target:'c:/tools/app.exe'}, {target: {}}, {target:'javascript:alert(1)'}]).length`), 1);
  assert.equal(read(`normalizeRecent([{target:'C:\\\\Tools\\\\App.exe'}])[0].name`), 'App');
  assert.equal(read(`normalizeItems([{name:'One',target:'a',id:'duplicate'}, {name:'Two',target:'b',id:'duplicate'}]).map(item => item.id).every((id, i, all) => all.indexOf(id) === i)`), true);
});

test('Dock preferences and separators survive validation without becoming launch targets', () => {
  const read = config(); const defaults = read('normalizeSettings({})');
  assert.equal(defaults.runningIndicators,true); assert.equal(defaults.hideOnFullscreen,true);
  assert.equal(defaults.iconSize,64); assert.equal(defaults.dockWidth,56);
  const settings = read("normalizeSettings({iconSize:100,dockWidth:20,accentColor:'#abcdef',runningIndicators:false,hideOnFullscreen:false})");
  assert.equal(settings.iconSize,72); assert.equal(settings.dockWidth,40); assert.equal(settings.accentColor,'#ABCDEF');
  assert.equal(settings.runningIndicators,false); assert.equal(settings.hideOnFullscreen,false);
  assert.equal(read("normalizeSettings({accentColor:'red'}).accentColor"),'#0A84FF');
  const items = read("normalizeItems([{id:'same',type:'separator'},{id:'same',name:'App',target:'wt.exe'}])");
  assert.equal(items.length,2); assert.equal(items[0].target,undefined); assert.notEqual(items[0].id,items[1].id);
  assert.equal(read("normalizeItems(Array.from({length:600}, (_, i) => ({id:String(i),type:'separator'}))).length"),500);
});

test('the separate application library accepts up to 2000 valid targets without changing the 500-pin limit', () => {
  const read = config();
  assert.equal(read("normalizeItems(Array.from({length:2100},(_,i)=>({id:'app-'+i,name:'App '+i,target:'C:/Apps/'+i+'.exe'})),[],false,2000).length"),2000);
  assert.equal(read("normalizeItems(Array.from({length:2100},(_,i)=>({id:'app-'+i,name:'App '+i,target:'C:/Apps/'+i+'.exe'}))).length"),500);
  assert.equal(read("normalizeItems([{id:'x',name:'Bad',target:'javascript:alert(1)'},{id:'y',name:'Valid',target:'C:/Valid.exe'}],[],false,2000).length"),1);
});

test('two windows merge item edits without losing collected shortcuts or restoring removals', () => {
  const read = config();
  const base = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const merge = (current, desired) => read(`mergeItemChanges(${JSON.stringify(base)},${JSON.stringify(current)},${JSON.stringify(desired)})`);
  const collected = { id: 'collected', name: 'Collected' }, manual = { id: 'manual', name: 'Manual' };
  assert.deepEqual(merge([...base, collected], [...base, manual]), [...base, collected, manual]);
  assert.deepEqual(merge([base[1], collected], [...base, manual]), [base[1], collected, manual]);
  assert.deepEqual(merge([...base, collected], [base[1], base[0]]), [base[1], base[0], collected]);
  assert.deepEqual(merge([{ ...base[0], name: 'Updated' }, base[1], collected], [base[0], manual]), [{ ...base[0], name: 'Updated' }, collected, manual]);
  assert.deepEqual(merge([base[1], base[0]], [...base, manual]), [base[1], base[0], manual]);
  const scan = { id: 'scan', target: 'C:/Desktop/App.lnk' };
  const archive = { id: 'archive', target: 'C:/Dock/App.lnk', collectedFrom: 'c:/desktop/app.lnk' };
  assert.deepEqual(merge([...base, scan], [...base, archive]), [...base, archive]);
  assert.deepEqual(merge([...base, scan], [...base, { ...scan, id: 'manual' }]), [...base, scan]);
});

test('old native artwork is invalidated without losing pins or collected shortcuts; corrected artwork survives restart', () => {
  const entries = [
    { id:'old', name:'Old app', target:'apps-folder:Vendor.Old', icon:'data:image/png;base64,AAAA' },
    { id:'shortcut', name:'Collected', target:'C:/Dock/App.lnk', collectedFrom:'C:/Desktop/App.lnk', icon:'data:image/png;base64,AAAA' },
    { id:'new', name:'New app', target:'apps-folder:Vendor.New', icon:'data:image/png;base64,AAAA', iconVersion:2 },
  ];
  const read = config({ 'lume-dock-items-v1':JSON.stringify(entries), 'lume-dock-library-v1':JSON.stringify(entries) });
  for (const key of ['items', 'libraryItems']) {
    const values = read(key);
    assert.equal(values.length, 3);
    assert.equal(values[0].target, entries[0].target);
    assert.equal(values[0].icon, undefined);
    assert.equal(values[1].collectedFrom, entries[1].collectedFrom);
    assert.equal(values[1].icon, undefined);
    assert.equal(values[2].icon, entries[2].icon);
    assert.equal(values[2].iconVersion, 2);
  }
});
