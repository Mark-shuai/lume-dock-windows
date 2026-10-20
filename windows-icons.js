const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('./helper-processes');
let script;
async function resolveShortcuts(targets) {
  script ??= fs.readFile(path.join(__dirname, 'scripts', 'resolve-icons.ps1'), 'utf8');
  const command = Buffer.from(await script, 'utf16le').toString('base64');
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const child = execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', command], {
      windowsHide: true, timeout: 12000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8',
    }, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); } catch (error) { reject(error); }
    });
    child.stdin.on('error', () => {});
    // Paths are JSON data on stdin, never interpolated into PowerShell source.
    child.stdin.end(JSON.stringify(targets));
  });
}
function createWindowsIconLoader({ readIcon, resolve = resolveShortcuts }) {
  let queue = [];
  let scheduled = false;
  let flushing = false;
  async function flush() {
    scheduled = false;
    if (flushing || !queue.length) return;
    flushing = true;
    const batch = queue.splice(0, 64);
    let records = [];
    try { records = await resolve(batch.map(item => item.target)); } catch { /* Shell fallback. */ }
    const mapped = new Map((Array.isArray(records) ? records : []).filter(item => item && typeof item.source === 'string').map(item => [item.source.toLowerCase(), item]));
    for (const request of batch) {
      const record = mapped.get(request.target.toLowerCase());
      if (typeof record?.icon === 'string' && /^data:image\/png;base64,[a-z\d+/=]+$/i.test(record.icon) && record.icon.length <= 128 * 1024) {
        request.done(record.icon);
        continue;
      }
      let result = null;
      const candidates = [...new Set([...(Array.isArray(record?.candidates) ? record.candidates : []), request.target])];
      for (const candidate of candidates) {
        if (typeof candidate !== 'string' || !candidate || candidate.length > 4096 || /[\x00-\x1f]/.test(candidate) || !path.win32.isAbsolute(candidate)) continue;
        try { result = await readIcon(candidate); } catch { /* Try next source. */ }
        if (result) break;
      }
      request.done(result);
    }
    flushing = false;
    if (queue.length) schedule();
  }
  function schedule() {
    if (!scheduled) { scheduled = true; setImmediate(() => void flush()); }
  }
  return target => {
    if (!/\.(lnk|url)$/i.test(target)) return readIcon(target);
    return new Promise(done => { queue.push({ target, done }); schedule(); });
  };
}
module.exports = { createWindowsIconLoader };
