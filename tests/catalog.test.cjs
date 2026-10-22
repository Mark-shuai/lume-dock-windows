const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createAppCatalog } = require('../windows-apps');

const file = (name) => ({ name, isDirectory: () => false, isFile: () => true });
const directory = (name) => ({ name, isDirectory: () => true, isFile: () => false });
function fixture({ run, readdir } = {}) {
  const calls = [];
  const options = {
    platform: 'win32', env: { APPDATA: 'C:\\User', ProgramData: 'C:\\Common', SystemRoot: 'C:\\Windows' },
    io: { readFile: (...args) => fs.readFile(...args), readdir: readdir || (async (root) => {
      if (root.endsWith('Tools')) return [file('Editor.lnk')];
      return root.includes('Common') ? [file('EDITOR.lnk'), file('Help.url')] : [directory('Tools')];
    }) },
    run: async (...args) => {
      calls.push(args);
      if (run) return run(...args);
      return { stdout: '\uFEFF' + JSON.stringify([
        { name: 'Editor', appId: 'Vendor.Editor', icon: null },
        { name: '计算器', appId: 'Microsoft.WindowsCalculator_123!App', icon: 'data:image/png;base64,AAAA' },
      ]) };
    },
  };
  return { options, calls };
}

test('collects nested Start menu shortcuts and registered apps without hiding same-name programs before identity resolution', async () => {
  const { options, calls } = fixture();
  const result = await createAppCatalog(options).list();
  assert.equal(result.items.length, 5);
  assert.equal(result.warnings.length, 0);
  assert.match(result.items.find((app) => app.name === 'Editor').target, /Tools\\Editor.lnk$/);
  const calculator = result.items.find((app) => app.name === '计算器');
  assert.equal(calculator.target, 'apps-folder:Microsoft.WindowsCalculator_123!App');
  assert.equal(calculator.icon, undefined, 'catalog never retains native image data');
  assert.equal(calculator.iconVersion, undefined);
  assert.equal(calls[0][0], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(calls[0][2].windowsHide, true);
  assert.equal(calls[0][2].timeout, 45000);
  const script = Buffer.from(calls[0][1].at(-1), 'base64').toString('utf16le');
  assert.match(script, /Get-StartApps/);
  assert.doesNotMatch(script, /SHCreateItemFromParsingName|Add-Type|LumeShellIcon|System.Drawing/, 'discovery does not extract icons');
});

test('PowerShell failure preserves Start menu apps and malformed results do not crash', async () => {
  for (const run of [async () => { throw new Error('denied'); }, async () => ({ stdout: 'invalid JSON' })]) {
    const { options } = fixture({ run });
    const result = await createAppCatalog(options).list();
    assert.equal(result.items.length, 3);
    assert.equal(result.error, undefined);
    assert.equal(result.warnings.length, 1);
  }
});

test('concurrent and cached requests share discovery; explicit refresh reruns it', async () => {
  const { options, calls } = fixture();
  const catalog = createAppCatalog(options);
  const [a, b] = await Promise.all([catalog.list(), catalog.list()]);
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  await catalog.list();
  assert.equal(calls.length, 1);
  await catalog.list({ refresh: true });
  assert.equal(calls.length, 2);
});

test('failed refresh keeps a usable cache; no sources produces retryable error', async () => {
  let fail = false;
  const { options } = fixture({ run: async () => {
    if (fail) throw new Error('blocked');
    return { stdout: JSON.stringify([{ name: '计算器', appId: 'Vendor!Calculator' }]) };
  }, readdir: async () => { throw new Error('access denied'); } });
  const catalog = createAppCatalog(options);
  const first = await catalog.list();
  assert.equal(first.items.length, 1);
  fail = true;
  const result = await catalog.list({ refresh: true });
  assert.equal(result.stale, true);
  assert.equal(result.items.length, 1);
  const failed = await createAppCatalog(options).list();
  assert.ok(failed.error);
  assert.equal(failed.items.length, 0);
});

test('unsupported hosts do not invoke Windows discovery', async () => {
  const { options, calls } = fixture();
  const result = await createAppCatalog({ ...options, platform: 'darwin' }).list();
  assert.ok(result.error);
  assert.equal(calls.length, 0);
});


test('large metadata catalogs do not retain legacy inline artwork', async () => {
  const records = Array.from({ length: 1000 }, (_, i) => ({ name: 'App ' + i, appId: 'Vendor.App.' + i,
    icon: 'data:image/png;base64,' + 'A'.repeat(4096) }));
  const { options } = fixture({ run: async () => ({ stdout: JSON.stringify(records) }), readdir: async () => [] });
  const result = await createAppCatalog(options).list();
  assert.equal(result.items.length, 1000);
  assert.ok(result.items.every(item => !Object.hasOwn(item, 'icon')));
  assert.ok(JSON.stringify(result).length < 200000, 'catalog size depends on metadata, not PNG strings');
});
