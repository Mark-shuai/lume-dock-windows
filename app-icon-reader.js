const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('./helper-processes');

// Read AppsFolder artwork without rescanning the catalog. A single helper is
// reused for bursts, then released; the shared icon service owns the cache.
function createAppIconReader({ supported = process.platform === 'win32', spawnProcess = spawn,
  readScript = () => fs.readFileSync(path.join(__dirname, 'scripts/resolve-app-icons.ps1'), 'utf8'),
  idleMs = 2000, timeoutMs = 15000, later = setTimeout, cancel = clearTimeout } = {}) {
  let child, command, timer, idle;
  let buffer = '', active = [], queue = [], scheduled = false, disposed = false;
  function stop(source = child) {
    if (source !== child) return;
    const previous = child;
    child = null;
    cancel(timer); cancel(idle); timer = idle = null;
    buffer = '';
    const unfinished = [...active, ...queue]; active = []; queue = [];
    for (const request of unfinished) request.done(null);
    try { previous?.kill(); } catch { /* Registry retries owned children on quit. */ }
  }
  function schedule() {
    if (!scheduled) { scheduled = true; setImmediate(pump); }
  }
  function start() {
    command ??= Buffer.from(readScript(), 'utf16le').toString('base64');
    const executable = path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const current = spawnProcess(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', command],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = current;
    current.stdout.setEncoding('utf8');
    current.stdout.on('data', text => {
      if (current !== child) return;
      buffer += text;
      if (buffer.length > 8 * 1024 * 1024) { stop(current); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim().replace(/^\uFEFF/, '');
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        let records;
        try { records = JSON.parse(line); } catch { stop(current); return; }
        if (!active.length || !Array.isArray(records)) { stop(current); return; }
        const mapped = new Map(records.filter(record => typeof record?.source === 'string')
          .map(record => [record.source.toLowerCase(), record.icon]));
        cancel(timer); timer = null;
        const batch = active; active = [];
        for (const request of batch) {
          const icon = mapped.get(request.target.toLowerCase());
          request.done(typeof icon === 'string' && icon.length <= 128 * 1024 && /^data:image\/png;base64,[a-z\d+/=]+$/i.test(icon) ? icon : null);
        }
        if (queue.length) schedule();
        else { idle = later(() => stop(current), idleMs); idle?.unref?.(); }
      }
    });
    current.stderr.on('data', () => {});
    current.stdin.on('error', () => stop(current));
    current.on('error', () => stop(current));
    current.on('exit', () => stop(current));
  }
  function pump() {
    scheduled = false;
    if (disposed || active.length || !queue.length) return;
    cancel(idle); idle = null;
    try {
      if (!child) start();
      active = queue.splice(0, 64);
      const current = child;
      timer = later(() => stop(current), timeoutMs); timer?.unref?.();
      current.stdin.write(JSON.stringify(active.map(request => request.target)) + '\n');
    } catch { stop(); }
  }
  return {
    get(target) {
      if (disposed || !supported || typeof target !== 'string' || !target.startsWith('apps-folder:') ||
        target.length <= 12 || target.length > 4096 || /[\x00-\x1f]/.test(target) || active.length + queue.length >= 256) return Promise.resolve(null);
      cancel(idle); idle = null;
      return new Promise(done => { queue.push({ target, done }); schedule(); });
    },
    dispose() { disposed = true; stop(); },
  };
}
module.exports = { createAppIconReader };
