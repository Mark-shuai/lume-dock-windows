const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore, STORAGE_KEY, MAX_BYTES } = require('../renderer/custom-icons');
const { rasterSize } = require('../custom-icon-image');
const image = 'data:image/png;base64,AAAA';
function memory() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
test('custom icons survive restart, follow Windows path aliases and restore across the whole app group', () => {
  const storage = memory();
  const a = createStore(storage);
  const item = { target: 'apps-folder:Vendor.App', aliases: ['C:/Desktop/App.lnk', 'C:/Menu/App.lnk'] };
  a.set(item, image);
  const b = createStore(storage);
  assert.equal(b.get({ target: 'c:\\desktop\\app.lnk' }), image);
  assert.equal(b.get({ target: 'apps-folder:Vendor.Other' }), null);
  b.set({ target: 'C:/Menu/App.lnk' }, null);
  a.sync(); assert.equal(a.get(item), null);
  assert.equal(a.export().length, 0);
});
test('independent windows merge changes and resets without resurrecting a stale icon', () => {
  const storage = memory(), a = createStore(storage), b = createStore(storage);
  a.set({ target: 'a' }, image);
  b.set({ target: 'b' }, image);
  a.set({ target: 'a' }, null);
  assert.deepEqual(a.export().map(record => record.keys), [['b']]);
  b.set({ target: 'c' }, image);
  assert.deepEqual(b.export().map(record => record.keys), [['b'], ['c']]);
  b.link({ target: 'new-b', aliases: ['b'] });
  assert.equal(createStore(storage).get({ target: 'new-b' }), image);
  a.set({target:'b'},null);
  b.link({target:'another-b',aliases:['b']});
  assert.equal(b.get({target:'another-b'}),null,'Linking must not resurrect another window’s reset');
});
test('built-in placeholder artwork survives later target resolution; imports include embedded images', () => {
  const a = createStore(memory());
  a.set({ id: 'files', target: '' }, image);
  assert.equal(a.get({ id: 'files', target: 'C:/Users/Demo' }), image);
  const b = createStore(memory()); b.import(a.export());
  assert.equal(b.get({ id: 'files' }), image);
  b.set({ id: 'files' }, null); assert.equal(b.export().length, 0);
});
test('corrupt data, oversized images, record count and storage budget are bounded and failed writes preserve artwork', () => {
  const storage = memory(); storage.setItem(STORAGE_KEY, '{}');
  const a = createStore(storage); assert.equal(a.export().length, 0);
  assert.throws(() => a.set({ target: 'a' }, 'data:image/svg+xml;base64,AAAA'), /无效/);
  assert.throws(() => a.set({ target: 'a' }, image + 'A'.repeat(48 * 1024)), /无效/);
  a.set({ target: 'a' }, image);
  const raw = storage.getItem(STORAGE_KEY);
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => a.set({ target: 'a' }, null), /保存失败/);
  assert.equal(a.get({ target: 'a' }), image);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  const b = createStore(memory());
  for (let i = 0; i < 100; i++) b.set({ target: `app:${i}` }, image);
  assert.throws(() => b.set({ target: 'overflow' }, image), /已满/);
  assert.equal(b.export().length, 100);
  assert.throws(() => b.import([{ keys: ['bad'], icon: 'no' }]), /无效/);
  const c = createStore(memory()); let full = false;
  for (let i = 0; i < 100; i++) {
    try { c.set({ target: `app:${i}` }, image + 'A'.repeat(40 * 1024)); }
    catch { full = true; break; }
  }
  assert.equal(full, true); assert.ok(JSON.stringify(c.export()).length * 2 <= MAX_BYTES);
});
test('raster metadata validates dimensions before decoding even for very small compressed inputs', () => {
  const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(65535,16); png.writeUInt32BE(1,20);
  assert.deepEqual(rasterSize(png), { width: 65535, height: 1 });
  assert.throws(() => rasterSize(Buffer.from('<svg></svg>')), /格式无效/);

});
