const childProcess = require('node:child_process');
const { promisify } = require('node:util');

function createHelperRegistry({ timeoutMs = 1500 } = {}) {
  const children = new Map();
  let stopping;
  let closed = false;
  return {
    assertOpen() { if (closed) throw new Error('Lume Dock is shutting down'); },
    track(child) {
      if (!child?.once || children.has(child)) return child;
      const done = new Promise(resolve => child.once('close', () => { children.delete(child); resolve(); }));
      children.set(child, done);
      if (closed) { try { child.kill('SIGKILL'); } catch {} }
      return child;
    },
    stop() {
      if (stopping) return stopping;
      closed = true;
      const current = [...children];
      for (const [child] of current) { try { child.kill('SIGKILL'); } catch {} }
      stopping = (async () => {
        if (!current.length) return [];
        let timer;
        try {
          await Promise.race([Promise.all(current.map(([, done]) => done)), new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
          return [...children.keys()].map(child => child.pid).filter(Number.isSafeInteger);
        } finally { clearTimeout(timer); }
      })();
      return stopping;
    },
  };
}
const registry = createHelperRegistry();
function execFile(...args) { registry.assertOpen(); return registry.track(childProcess.execFile(...args)); }
execFile[promisify.custom] = (...args) => new Promise((resolve, reject) => {
  execFile(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
});
function spawn(...args) { registry.assertOpen(); return registry.track(childProcess.spawn(...args)); }
module.exports = { createHelperRegistry, execFile, spawn, track: child => registry.track(child), stop: () => registry.stop() };
