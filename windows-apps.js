const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('./helper-processes');
const { promisify } = require('node:util');

// Read only the Windows app catalog and Start menu, never crawl drive contents.
function createAppCatalog({ platform = process.platform, env = process.env, io = fs,
  run = promisify(execFile), now = Date.now } = {}) {
  let cache = null;
  let pending = null;

  async function scan() {
    if (platform !== 'win32') return { items: [], warnings: [], error: '全部应用需要在 Windows 11 上读取，可先手动添加入口' };
    const warnings = [];
    const records = new Map();
    const roots = [env.APPDATA, env.ProgramData || env.PROGRAMDATA]
      .filter(Boolean).map((root) => path.win32.join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
    let readable = 0;
    async function walk(directory, depth = 0) {
      if (depth > 12) return;
      try {
        const entries = await io.readdir(directory, { withFileTypes: true });
        readable++;
        for (const entry of entries) {
          const target = path.win32.join(directory, entry.name);
          if (entry.isDirectory()) await walk(target, depth + 1);
          else if (entry.isFile() && /\.(lnk|url|appref-ms)$/i.test(entry.name)) {
            const name = entry.name.replace(/\.(lnk|url|appref-ms)$/i, '');
            const key = target.toLowerCase();
            if (!records.has(key)) records.set(key, { id: `shortcut:${target.toLowerCase()}`, name, target, source: '开始菜单' });
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') warnings.push('部分开始菜单目录无法读取');
      }
    }
    const readRegistered = async () => {
      try {
        const script = await io.readFile(path.join(__dirname, 'scripts', 'list-apps.ps1'), 'utf8');
        const command = Buffer.from(script, 'utf16le').toString('base64');
        const executable = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        const { stdout } = await run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', command], {
          windowsHide: true, timeout: 45000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8',
        });
        const parsed = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
        if (!Array.isArray(parsed)) throw new Error('Invalid application catalog');
        return parsed.filter((item) => item && typeof item.name === 'string' && item.name.trim() && typeof item.appId === 'string' && item.appId.trim());
      } catch {
        warnings.push('Windows 应用列表暂时无法读取，已尝试使用开始菜单');
        return null;
      }
    };
    const [registered] = await Promise.all([readRegistered(), (async () => {
      // Keep same-name shortcuts until actual launch identities can be compared.
      for (const root of roots) await walk(root);
    })()]);
    for (const item of registered || []) {
      const key = `app:${item.appId.toLowerCase()}`;
      records.set(key, {
        id: `app:${item.appId}`, name: item.name, target: `apps-folder:${item.appId}`,
        source: item.appId.includes('!') ? 'Windows 应用' : '已安装应用',
      });
    }
    return {
      items: [...records.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })),
      warnings: [...new Set(warnings)],
      ...(!readable && registered === null ? { error: '无法读取应用列表，请重试或手动添加' } : {}),
    };
  }
  return {
    list({ refresh = false } = {}) {
      if (pending) return pending;
      if (!refresh && cache && now() - cache.time < 60000) return Promise.resolve(cache.result);
      pending = scan().then((result) => {
        // A failed refresh must not erase an already usable catalog.
        if (result.error && cache) return { ...cache.result, warnings: [result.error], stale: true };
        if (!result.error) cache = { result, time: now() };
        return result;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}

module.exports = { createAppCatalog };
