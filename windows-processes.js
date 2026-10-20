const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('./helper-processes');
const scripts = new Map();
async function runScript(name, input, execute = execFile) {
  if (!scripts.has(name)) scripts.set(name, fs.readFile(path.join(__dirname, 'scripts', name), 'utf8'));
  const command = Buffer.from(await scripts.get(name), 'utf16le').toString('base64');
  const executable = path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const child = execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
      windowsHide: true, timeout: 8000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8',
    }, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); } catch (error) { reject(error); }
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(input ?? []));
  });
}
function executableKey(value) {
  return typeof value === 'string' && path.win32.isAbsolute(value) && /\.exe$/i.test(value) ? path.win32.normalize(value).toLowerCase() : '';
}
function eligibleTarget(value) {
  return typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f]/.test(value) &&
    ((path.win32.isAbsolute(value) && /\.(lnk|exe)$/i.test(value)) || /^[\w.-]+\.exe$/i.test(value));
}
function createProcessService({ supported = process.platform === 'win32', query = () => runScript('running-processes.ps1'), resolve = targets => runScript('resolve-targets.ps1', targets), now = Date.now } = {}) {
  const cache = new Map();
  let processPaths = new Set();
  let processTime = -Infinity;
  let processPending;
  let epoch = 0;
  let pending;
  async function refreshProcesses() {
    if (now() - processTime < 10000) return;
    const startedAt = epoch;
    if (!processPending) processPending = Promise.resolve().then(query).then(records => {
      if (!Array.isArray(records)) throw new Error('Invalid process response');
      processPaths = new Set(records.map(record => executableKey(typeof record === 'string' ? record : record?.ExecutablePath)).filter(Boolean));
      processTime = startedAt === epoch ? now() : -Infinity;
    }).catch(error => { processPaths.clear(); processTime = -Infinity; throw error; }).finally(() => { processPending = null; });
    await processPending;
  }
  async function inspect(targets, refresh) {
    const requested = [...new Set((Array.isArray(targets) ? targets : []).filter(eligibleTarget))].slice(0, 500);
    if (!supported || !requested.length) return { targets: [], supported };
    try {
      // A launch refresh may bypass the idle cache, but never spawn more than once per second.
      if (refresh === true && now() - processTime >= 1000) processTime = -Infinity;
      await refreshProcesses();
      const missing = requested.filter(target => !cache.has(target) || cache.get(target).expires <= now());
      for (let offset = 0; offset < missing.length; offset += 64) {
        const batch = missing.slice(offset, offset + 64);
        const records = await resolve(batch);
        if (!Array.isArray(records)) throw new Error('Invalid shortcut response');
        const mapped = new Map(records.filter(record => typeof record?.source === 'string').map(record => [record.source.toLowerCase(), executableKey(record.target)]));
        for (const target of batch) {
          cache.delete(target);
          cache.set(target, { value: mapped.get(target.toLowerCase()) || '', expires: now() + 300000 });
          while (cache.size > 512) cache.delete(cache.keys().next().value);
        }
      }
      return { targets: requested.filter(target => processPaths.has(cache.get(target)?.value)), supported: true };
    } catch { return { targets: [], supported: true, error: '运行状态暂不可用' }; }
  }
  return {
    async get(targets, refresh = false) {
      // Serialize batches; do not start parallel CIM or shortcut resolver processes.
      while (pending) await pending;
      const task = inspect(targets, refresh);
      pending = task;
      try { return await task; } finally { if (pending === task) pending = null; }
    },
    invalidate() { epoch++; processTime = -Infinity; },
    clear() { epoch++; cache.clear(); processPaths.clear(); processTime = -Infinity; },
  };
}
module.exports = { createProcessService, executableKey, eligibleTarget, runScript };
