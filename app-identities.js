const path = require('node:path');
const { runScript } = require('./windows-processes');
const { targetKey } = require('./renderer/app-identity');

function identityForRecord(record) {
  if (typeof record?.target !== 'string' || !path.win32.isAbsolute(record.target) || !/\.exe$/i.test(record.target)) return '';
  if (record.arguments != null && typeof record.arguments !== 'string') return '';
  if (record.workingDirectory != null && typeof record.workingDirectory !== 'string') return '';
  const executable = path.win32.normalize(record.target).toLowerCase();
  const args = typeof record.arguments === 'string' ? record.arguments.trim() : '';
  const directory = typeof record.workingDirectory === 'string' && record.workingDirectory.trim() ? record.workingDirectory.trim() : path.win32.dirname(executable);
  if (!path.win32.isAbsolute(directory) || args.length > 4096 || directory.length > 4096) return '';
  return `exe:${JSON.stringify([executable, args, path.win32.normalize(directory).toLowerCase()])}`;
}

function identityKeysForRecord(record) {
  const keys = [identityForRecord(record)].filter(Boolean);
  // A shortcut with custom arguments may launch a profile or a separate tool.
  if ((!record?.arguments || typeof record.arguments === 'string' && !record.arguments.trim()) && typeof record?.appId === 'string' && record.appId.trim() && record.appId.length <= 2048) keys.push(`app:${record.appId.toLowerCase()}`);
  return keys;
}

function createIdentityResolver({ supported = process.platform === 'win32', resolve = targets => runScript('app-identities.ps1', targets), now = Date.now } = {}) {
  const cache = new Map();
  let pending;
  async function inspect(input, refresh) {
    const targets = [...new Map((Array.isArray(input) ? input : []).filter(value => typeof value === 'string' && value.length <= 4096 && !/[\x00-\x1f]/.test(value) &&
      (/^(?:[a-z]:[\\/]|\\\\)/i.test(value) && /\.(?:lnk|exe)$/i.test(value) || value.startsWith('apps-folder:'))).map(value => [targetKey(value), value])).values()].slice(0, 3000);
    if (!supported) return [];
    const result = [];
    for (let offset = 0; offset < targets.length; offset += 512) {
      const batch = targets.slice(offset, offset + 512);
      const missing = batch.filter(target => refresh || !cache.has(targetKey(target)) || cache.get(targetKey(target)).expires <= now());
      if (missing.length) {
        let records = [], failed = false;
        try { records = await resolve(missing); if (!Array.isArray(records)) failed = true; }
        catch { failed = true; /* Unresolved entries stay visible separately. */ }
        const mapped = new Map((Array.isArray(records) ? records : []).filter(record => typeof record?.source === 'string').map(record => [targetKey(record.source), identityKeysForRecord(record)]));
        for (const target of missing) {
          const key = targetKey(target), value = mapped.get(key) || (target.startsWith('apps-folder:') ? [`app:${target.slice(12).toLowerCase()}`] : []);
          if (failed && cache.get(key)?.value.length) continue;
          cache.delete(key);
          cache.set(key, { value, expires: now() + (value.length ? 300000 : 30000) });
          while (cache.size > 4096) cache.delete(cache.keys().next().value);
        }
      }
      for (const source of batch) {
        const identity = cache.get(targetKey(source))?.value;
        if (identity?.length) result.push({ source, identity });
      }
    }
    return result;
  }
  return {
    async get(targets, refresh = false) {
      while (pending) await pending;
      const task = inspect(targets, refresh); pending = task;
      try { return await task; } finally { if (pending === task) pending = null; }
    },
  };
}
module.exports = { createIdentityResolver, identityForRecord, identityKeysForRecord };
