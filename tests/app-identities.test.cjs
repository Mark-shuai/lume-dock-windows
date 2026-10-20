const { test } = require('node:test');
const assert = require('node:assert/strict');
const { identityForRecord, identityKeysForRecord, createIdentityResolver } = require('../app-identities');
const { mergeEntries, targetKey, entryKind } = require('../renderer/app-identity');
const record = (target, args = '', directory = '') => ({ target, arguments: args, workingDirectory: directory });

test('program identity compares actual executable and preserves arguments, working directories and versions', () => {
  const key = identityForRecord(record('C:/Apps/Player.exe'));
  assert.equal(key, identityForRecord(record('c:\\apps\\.\\PLAYER.EXE', '', 'C:/Apps')));
  assert.notEqual(key, identityForRecord(record('C:/Apps/Player.exe', '--profile Work')));
  assert.notEqual(identityForRecord(record('C:/Apps/Player.exe', '--profile Work')), identityForRecord(record('C:/Apps/Player.exe', '--profile work')));
  assert.notEqual(key, identityForRecord(record('C:/Apps/Player.exe', '', 'D:/Project')));
  assert.notEqual(key, identityForRecord(record('C:/Apps32/Player.exe')));
  for (const value of [null, {}, {target:'https://example.com'}, record('C:/ReadMe.pdf'), {target:'C:/App.exe',arguments:123}]) assert.equal(identityForRecord(value), '');
  assert.deepEqual(identityKeysForRecord({ appId:'Vendor!App' }), ['app:vendor!app']);
  assert.equal(identityKeysForRecord({ ...record('C:/App.exe', '--profile Work'), appId:'Vendor!App' }).some(key => key.startsWith('app:')), false);
});

test('desktop, Start menu and registered aliases merge transitively with artwork and searchable names', () => {
  const entries = [
    { name:'Player Desktop', target:'C:/Desktop/Player.lnk' },
    { name:'Player', target:'C:/Start/Player.lnk' },
    { name:'播放器', target:'apps-folder:Vendor.Player', icon:'data:image/png;base64,AAAA' },
    { name:'Player', target:'C:/Other/Player.exe' },
    { name:'Player', target:'C:/Broken/Player.lnk' },
  ];
  const identities = new Map([
    [targetKey(entries[0].target), ['exe:player']],
    [targetKey(entries[1].target), ['exe:player','app:vendor.player']],
    [targetKey(entries[2].target), ['app:vendor.player']],
    [targetKey(entries[3].target), ['exe:other-player']],
  ]);
  const result = mergeEntries(entries, identities);
  assert.equal(result.length, 3);
  const app = result.find(item => item.name === '播放器');
  assert.equal(app.icon, 'data:image/png;base64,AAAA');
  assert.equal(app.aliases.length, 3);
  assert.deepEqual(app.searchNames, ['Player Desktop','Player','播放器']);
  assert.equal(result.some(item => item.target === 'C:/Broken/Player.lnk'), true);
});

test('large alias groups do not overflow the call stack', () => {
  const entries = Array.from({length:6000},(_,i)=>({name:'App '+i,target:'C:/Links/'+i+'.lnk'}));
  const identities = new Map(entries.map(item=>[targetKey(item.target),['exe:one-app']]));
  const result = mergeEntries(entries,identities);
  assert.equal(result.length,1);assert.equal(result[0].aliases.length,6000);
});

test('resolver serializes bounded batches, caches results and retries explicit refresh', async () => {
  let active = 0, maximum = 0, count = 0, time = 0;
  const resolver = createIdentityResolver({ supported:true, now:()=>time, resolve:async targets => {
    active++; maximum = Math.max(maximum, active); count++;
    assert.ok(targets.length <= 512);
    await new Promise(resolve=>setImmediate(resolve)); active--;
    return targets.map(source=>({source,...record('C:/Apps/Player.exe')}));
  }});
  const targets = Array.from({length:1200}, (_,i)=>`C:/Desktop/${i}.lnk`);
  const [a,b] = await Promise.all([resolver.get(targets),resolver.get(targets)]);
  assert.equal(a.length,1200); assert.deepEqual(a,b); assert.equal(count,3); assert.equal(maximum,1);
  await resolver.get(targets,true); assert.equal(count,6);
  time=300001; await resolver.get(targets); assert.equal(count,9);
});

test('unresolved targets stay separate; lookup failures retain previous identities and are retried', async () => {
  let mode = 'ok', count = 0, time = 0;
  const resolver = createIdentityResolver({supported:true,now:()=>time,resolve:async targets=>{
    count++; if(mode==='throw')throw Error('unavailable'); if(mode==='invalid')return null;
    return targets.filter(source=>!source.includes('Broken')).map(source=>({source,...record('C:/App.exe')}));
  }});
  const targets=['C:/Desktop/App.lnk','C:/Broken.lnk','javascript:bad','https://example.com'];
  const first=await resolver.get(targets); assert.equal(first.length,1);
  mode='throw';assert.deepEqual(await resolver.get(targets,true),first);
  mode='invalid';time=300001;assert.deepEqual(await resolver.get(targets),first);
  mode='ok';await resolver.get(targets);assert.equal(count,4);
  let queried=false;
  assert.deepEqual(await createIdentityResolver({supported:false,resolve:()=>{queried=true;}}).get(targets),[]);
  assert.equal(queried,false);
});


test('classification uses program evidence and keeps generic shortcuts separate', () => {
  const apps = ['apps-folder:Vendor!App', 'C:/Apps/APP.EXE', 'D:\\Tools\\App.com', 'wt.exe', 'C:/Apps/Launch.appref-ms', 'ms-calendar:', 'ms-stickynotes:', 'preview:music'];
  const shortcuts = ['C:/Desktop/App.lnk', 'C:/Sites/Browser.url', 'C:/Docs/Readme.pdf', 'C:/Folder', 'https://site.test/app.exe', 'custom:app.exe', 'ms-settings:'];
  for (const target of apps) assert.equal(entryKind({ target }), 'apps', target);
  for (const target of shortcuts) assert.equal(entryKind({ target, kind: 'apps', source: '已安装应用' }), 'shortcuts', target);
  const identities = new Map([[targetKey(shortcuts[0]), ['exe:confirmed-program']]]);
  assert.equal(entryKind({ target: shortcuts[0] }, identities), 'apps');
  identities.set(targetKey(shortcuts[0]), ['app:confirmed-app-id']);
  assert.equal(entryKind({ target: shortcuts[0] }, identities), 'apps');
});

test('merged group retains app category even when its best artwork is a shortcut', () => {
  const entries = [
    {name:'Original app',target:'apps-folder:Vendor.App'},
    {name:'Shortcut artwork',target:'C:/Desktop/Item.lnk',icon:'data:image/png;base64,AAAA'},
    {name:'Document',target:'C:/Docs/Manual.pdf'},
  ];
  const identities = new Map(entries.slice(0,2).map(item => [targetKey(item.target), ['shared-test-alias']]));
  for (const ordered of [entries, [...entries].reverse()]) {
    const merged = mergeEntries(ordered, identities);
    assert.equal(merged.length, 2);
    assert.equal(merged.find(item => item.name === 'Shortcut artwork').kind, 'apps');
    assert.equal(merged.find(item => item.name === 'Document').kind, 'shortcuts');
    assert.equal(merged.filter(item => item.kind === 'apps').length, 1);
  }
});
