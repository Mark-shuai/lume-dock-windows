const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('./helper-processes');
function createFullscreenMonitor({ supported = process.platform === 'win32', spawnProcess = spawn, onState = () => {}, ownPid = process.pid,
  readScript = () => fs.readFileSync(path.join(__dirname, 'scripts/session-monitor.ps1'), 'utf8'),
  intervalMs = 2000, timeoutMs = 15000, now = Date.now, setTimer = setInterval, clearTimer = clearInterval,
  later = setTimeout, cancelLater = clearTimeout } = {}) {
  let enabled = false;
  let command;
  let child;
  let timer;
  let deadline;
  let waiting = false;
  let buffer = '';
  let failures = 0;
  let retryAt = 0;
  let lastState = false;
  function drop() {
    const previous = child;
    child = null; waiting = false; buffer = '';
    cancelLater(deadline); deadline = null;
    previous?.kill();
  }
  function fail(source) {
    if (source !== child) return;
    failures++;
    retryAt = now() + Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4));
    drop();
    // Keep the last known state when probing fails; do not flash over a game.
  }
  function start() {
    const executable = path.win32.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    let current;
    try {
      // Electron reads inside app.asar; the external PowerShell process cannot use -File there.
      command ??= Buffer.from('& {\n' + readScript() + '\n} -DockPid ' + (Number.isSafeInteger(ownPid) && ownPid > 0 ? ownPid : process.pid), 'utf16le').toString('base64');
      current = spawnProcess(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', command], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { failures++; retryAt = now() + 30000; return; }
    child = current;
    current.stdout.setEncoding('utf8');
    current.stdout.on('data', text => {
      if (current !== child) return;
      buffer += text;
      if (buffer.length > 65536) { fail(current); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim().replace(/^\uFEFF/, '');
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        try {
          const state = JSON.parse(line);
          if (!waiting || typeof state.fullscreen !== 'boolean' || typeof state.own !== 'boolean') { fail(current); return; }
          waiting = false; cancelLater(deadline); deadline = null;
          failures = 0; retryAt = 0;
          if (!state.own && state.fullscreen !== lastState) { lastState = state.fullscreen; onState(lastState); }
        } catch { fail(current); return; }
      }
    });
    // Drain diagnostics without retaining unbounded output or logging user data.
    current.stderr.on('data', () => {});
    current.stdin.on('error', () => fail(current));
    current.on('error', () => fail(current));
    current.on('exit', () => fail(current));
  }
  function probe() {
    if (!enabled || !supported || waiting || now() < retryAt) return;
    if (!child) start();
    const current = child;
    if (!current) return;
    waiting = true;
    deadline = later(() => fail(current), timeoutMs);
    try { current.stdin.write('probe\n'); } catch { fail(current); }
  }
  return {
    setEnabled(value) {
      const desired = value === true && supported;
      if (enabled === desired) return;
      enabled = desired;
      clearTimer(timer); timer = null;
      if (!enabled) { drop(); lastState = false; failures = 0; retryAt = 0; onState(false); return; }
      probe(); timer = setTimer(probe, intervalMs);
      timer?.unref?.();
    },
    dispose() { enabled = false; clearTimer(timer); timer = null; drop(); },
  };
}
function createFullscreenPolicy() {
  let active = false;
  let exempt = false;
  return {
    update(value) { active = value === true; if (!active) exempt = false; },
    reveal() { if (active) exempt = true; },
    get shouldHide() { return active && !exempt; },
  };
}
module.exports = { createFullscreenMonitor, createFullscreenPolicy };
