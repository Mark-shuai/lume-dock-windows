const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('./helper-processes');

const MENU_KEYS = [
  'HKCU\\Software\\Classes\\lnkfile\\shell\\LumeDock',
  'HKCU\\Software\\Classes\\InternetShortcut\\shell\\LumeDock',
];
function runReg(args) {
  return new Promise((resolve, reject) => {
    execFile(path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), args,
      { windowsHide: true }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout));
  });
}
async function setMenu(enabled, executable, registry = runReg) {
  if (enabled && (!path.win32.isAbsolute(executable) || /["\r\n]/.test(executable))) throw new Error('无效的安装位置');
  for (const key of MENU_KEYS) {
    if (enabled) {
      await registry(['add', key, '/ve', '/t', 'REG_SZ', '/d', '加入 Lume Dock', '/f']);
      await registry(['add', key, '/v', 'Icon', '/t', 'REG_SZ', '/d', `"${executable}",0`, '/f']);
      await registry(['add', key, '/v', 'MultiSelectModel', '/t', 'REG_SZ', '/d', 'Single', '/f']);
      await registry(['add', `${key}\\command`, '/ve', '/t', 'REG_SZ', '/d', `"${executable}" --dock-import "%1"`, '/f']);
    } else {
      // Query distinguishes a missing key from a failed delete (e.g. permissions).
      try { await registry(['query', key]); } catch (error) {
        // reg.exe uses exit 1 for a missing key. Querying its parent still verifies access.
        await registry(['query', 'HKCU\\Software\\Classes']);
        continue;
      }
      await registry(['delete', key, '/f']);
    }
  }
}
function cliImport(argv = []) {
  const index = argv.indexOf('--dock-import');
  return index < 0 || typeof argv[index + 1] !== 'string' ? null : argv[index + 1];
}
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function createIntegration({ directory, desktops, executable, supported, registry, trashItem, notify = () => {}, nativePath = path }) {
  const stateFile = path.join(directory, 'desktop-integration.json');
  const archive = path.join(directory, 'Shortcuts');
  let state = { enabled: false, pending: [] };
  let serial = Promise.resolve();
  let startupIssue = '';
  const ready = (async () => {
    try {
      const saved = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      state = { enabled: saved.enabled === true, pending: Array.isArray(saved.pending) ? saved.pending : [] };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (supported && state.enabled) {
      try { await setMenu(true, executable, registry); }
      catch { startupIssue = '右键菜单恢复失败，请关闭后重新开启'; }
    }
  })();
  function enqueue(work) {
    const result = serial.then(() => ready).then(work);
    serial = result.catch(() => {});
    return result;
  }
  async function persist(next) {
    await fs.mkdir(directory, { recursive: true });
    const temp = `${stateFile}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify(next), { flag: 'wx' }); await fs.rename(temp, stateFile); }
    finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    state = next;
  }
  return {
    status: () => enqueue(async () => ({ enabled: state.enabled, supported, message: startupIssue })),
    setEnabled: (enabled) => enqueue(async () => {
      if (!supported) return { ok: false, enabled: false, supported, message: '此功能需要安装后的 Windows 版本' };
      if (typeof enabled !== 'boolean') return { ok: false, enabled: state.enabled, supported };
      const previous = state.enabled;
      try {
        await setMenu(enabled, executable, registry);
        await persist({ ...state, enabled });
        startupIssue = ''; 
        return { ok: true, enabled, supported };
      } catch {
        // Best effort restore if a registry write or persistence failed partway.
        await setMenu(previous, executable, registry).catch(() => {});
        return { ok: false, enabled: previous, supported, message: '右键菜单设置失败，请重试' };
      }
    }),
    prepare: (source) => enqueue(async () => {
      if (!supported || !state.enabled) throw new Error('请先在设置中开启“桌面右键收纳”');
      if (typeof source !== 'string' || !nativePath.isAbsolute(source) || /[\x00-\x1f]/.test(source) || !/\.(lnk|url)$/i.test(source)) throw new Error('只支持桌面上的 .lnk 或 .url 快捷方式');
      const normalize = (file) => nativePath.resolve(file).toLocaleLowerCase();
      const roots = await desktops();
      if (!roots.some((root) => normalize(nativePath.dirname(source)) === normalize(root))) throw new Error('请选择桌面上的快捷方式');
      const info = await fs.lstat(source);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('请选择普通快捷方式文件');
      const canonical = await fs.realpath(source);
      const realRoots = await Promise.all(roots.map(root => fs.realpath(root).catch(() => null)));
      if (!realRoots.some(root => root && normalize(nativePath.dirname(canonical)) === normalize(root))) throw new Error('快捷方式不在桌面中');
      const contents = await fs.readFile(source);
      const digest = hash(contents);
      const existing = state.pending.find(item => normalize(item.source) === normalize(source) && item.digest === digest);
      if (existing) { notify(); return existing; }
      const id = crypto.randomUUID();
      await fs.mkdir(archive, { recursive: true });
      const target = path.join(archive, `${id}${nativePath.extname(source).toLowerCase()}`);
      await fs.writeFile(target, contents, { flag: 'wx' });
      const item = { id, source, target, digest, name: nativePath.basename(source).replace(/\.(lnk|url)$/i, '') };
      try { await persist({ ...state, pending: [...state.pending, item] }); }
      catch (error) { await fs.rm(target, { force: true }); throw error; }
      notify();
      return item;
    }),
    pending: () => enqueue(async () => state.pending.map(({ digest, ...item }) => item)),
    acknowledge: (id) => enqueue(async () => {
      const item = state.pending.find(entry => entry.id === id);
      if (!item) return { ok: true };
      // An acknowledgement is issued only after the renderer has saved the new entry.
      if (hash(await fs.readFile(item.target)) !== item.digest) throw new Error('收纳副本校验失败，桌面快捷方式已保留');
      let warning = '';
      try {
        const info = await fs.lstat(item.source);
        if (!info.isFile() || info.isSymbolicLink() || hash(await fs.readFile(item.source)) !== item.digest) {
          warning = '桌面快捷方式已发生变化，已保留';
        } else { await trashItem(item.source); }
      } catch (error) {
        if (error.code !== 'ENOENT') warning = '已加入程序坞，桌面快捷方式未能移入回收站，可手动移除';
      }
      await persist({ ...state, pending: state.pending.filter(entry => entry.id !== id) });
      return { ok: true, warning };
    }),
  };
}
module.exports = { MENU_KEYS, setMenu, cliImport, createIntegration };
