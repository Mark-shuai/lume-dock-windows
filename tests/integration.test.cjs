const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createIntegration, setMenu, cliImport, MENU_KEYS } = require('../windows-integration');

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lume-integration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'Desktop');
  const publicDesktop = path.join(root, 'Public');
  await fs.mkdir(desktop); await fs.mkdir(publicDesktop);
  const directory = path.join(root, 'Data');
  const calls = [];
  const config = { directory, supported: true, executable: 'C:\\Program Files\\Lume Dock\\Lume Dock.exe',
    desktops: async () => [desktop, publicDesktop], registry: async args => calls.push(args),
    trashItem: async file => { calls.push(['trash', file]); await fs.rename(file, file + '.recycled'); }, ...options };
  const service = createIntegration(config);
  return { service, root, desktop, publicDesktop, directory, calls, config };
}

test('right-click registration is per-user, quotes executable/path argument, and only targets shortcuts', async () => {
  const calls = [];
  await setMenu(true, 'C:\\Apps & Tools\\Lume Dock.exe', async args => calls.push(args));
  assert.equal(calls.filter(args => args[1].endsWith('\\command')).length, 2);
  for (const args of calls.filter(args => args[1].endsWith('\\command'))) {
    assert.equal(args[args.indexOf('/d') + 1], '"C:\\Apps & Tools\\Lume Dock.exe" --dock-import "%1"');
    assert.ok(args[1].startsWith('HKCU\\'));
  }
  assert.deepEqual(MENU_KEYS.map(key => key.split('\\')[3]), ['lnkfile', 'InternetShortcut']);
  calls.length = 0;
  await setMenu(false, '', async args => calls.push(args));
  assert.equal(calls.filter(args => args[0] === 'delete').length, 2);
  assert.equal(cliImport(['app.exe', '--dock-import', 'C:\\Desktop\\中文 空格.lnk']), 'C:\\Desktop\\中文 空格.lnk');
  assert.equal(cliImport(['app.exe', '--dock-import']), null);
  assert.equal(cliImport(), null);
});

test('default is off; enable/disable persists, unregisters and rejects disabled requests', async t => {
  const f = await fixture(t);
  assert.equal((await f.service.status()).enabled, false);
  await assert.rejects(f.service.prepare(path.join(f.desktop, 'App.lnk')), /开启/);
  assert.equal((await f.service.setEnabled(true)).ok, true);
  assert.equal((await createIntegration(f.config).status()).enabled, true);
  assert.equal((await f.service.setEnabled(false)).ok, true);
  assert.equal((await createIntegration(f.config).status()).enabled, false);
  assert.equal(f.calls.filter(args => args[0] === 'delete').length, 2);
});

test('failed registration rolls back preference; unsupported platforms do not touch registry', async t => {
  const f = await fixture(t, { registry: async args => { if (args[0] === 'add') throw new Error('denied'); } });
  assert.equal((await f.service.setEnabled(true)).ok, false);
  assert.equal((await f.service.status()).enabled, false);
  const unsupported = createIntegration({ ...f.config, supported: false, registry: async () => assert.fail('must not modify registry') });
  assert.equal((await unsupported.setEnabled(true)).ok, false);
});

test('archive persists original shortcut bytes before receipt; restart replays pending and acknowledgement recycles desktop file', async t => {
  const f = await fixture(t);
  await f.service.setEnabled(true);
  const source = path.join(f.desktop, '中文 空格 & 参数.lnk');
  const bytes = Buffer.from([0x4c, 0, 0, 0, 0x99, 0xf0, 0x20]);
  await fs.writeFile(source, bytes);
  const item = await f.service.prepare(source);
  assert.deepEqual(await fs.readFile(source), bytes);
  assert.deepEqual(await fs.readFile(item.target), bytes);
  assert.equal(f.calls.filter(call => call[0] === 'trash').length, 0);
  // Concurrent/repeated invocations before confirmation produce one entry.
  const again = await Promise.all([f.service.prepare(source), f.service.prepare(source)]);
  assert.ok(again.every(entry => entry.id === item.id));
  const restarted = createIntegration(f.config);
  assert.equal((await restarted.pending()).length, 1);
  assert.equal((await restarted.acknowledge(item.id)).ok, true);
  await assert.rejects(fs.access(source), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(source + '.recycled'), bytes);
  assert.deepEqual(await fs.readFile(item.target), bytes);
  assert.equal((await restarted.pending()).length, 0);
  assert.equal((await restarted.acknowledge(item.id)).ok, true);
});

test('non-desktop paths, program binaries and symbolic links are never collected or deleted', async t => {
  const f = await fixture(t); await f.service.setEnabled(true);
  const outside = path.join(f.root, 'Outside.lnk');
  const program = path.join(f.desktop, 'App.exe');
  const symlink = path.join(f.desktop, 'Link.lnk');
  await fs.writeFile(outside, 'outside'); await fs.writeFile(program, 'binary'); await fs.symlink(outside, symlink);
  for (const file of [outside, program, symlink, 'relative.lnk']) await assert.rejects(f.service.prepare(file));
  assert.equal(f.calls.filter(call => call[0] === 'trash').length, 0);
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside');
});

test('changed desktop shortcut is kept, archive corruption prevents deletion, public permission failure remains usable', async t => {
  const f = await fixture(t); await f.service.setEnabled(true);
  const source = path.join(f.desktop, 'Changed.url'); await fs.writeFile(source, 'old');
  const item = await f.service.prepare(source); await fs.writeFile(source, 'replacement');
  assert.match((await f.service.acknowledge(item.id)).warning, /发生变化/);
  assert.equal(await fs.readFile(source, 'utf8'), 'replacement');
  const broken = await f.service.prepare(source); await fs.writeFile(broken.target, 'corrupt');
  await assert.rejects(f.service.acknowledge(broken.id), /校验失败/);
  assert.equal(await fs.readFile(source, 'utf8'), 'replacement');
  const publicSource = path.join(f.publicDesktop, 'Public.lnk'); await fs.writeFile(publicSource, 'public');
  const publicItem = await f.service.prepare(publicSource);
  const denied = createIntegration({ ...f.config, trashItem: async () => { throw new Error('access denied'); } });
  assert.match((await denied.acknowledge(publicItem.id)).warning, /未能移入回收站/);
  assert.equal(await fs.readFile(publicSource, 'utf8'), 'public');
  assert.equal(await fs.readFile(publicItem.target, 'utf8'), 'public');
});
