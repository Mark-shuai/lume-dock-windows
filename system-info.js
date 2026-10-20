const { execFile } = require('./helper-processes');

function parseBatteryOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    const item = Array.isArray(value) ? value[0] : value;
    const level = Number(item?.EstimatedChargeRemaining);
    if (!Number.isFinite(level) || level < 0 || level > 100) return null;
    return {
      level: Math.round(level),
      charging: [2, 3, 6, 7, 8, 9].includes(Number(item?.BatteryStatus)),
    };
  } catch {
    return null;
  }
}

function getBattery({ platform = process.platform, execFileImpl = execFile } = {}) {
  if (platform !== 'win32') return Promise.resolve(null);
  const command = '$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus; if ($null -eq $b) { exit 0 }; $b | ConvertTo-Json -Compress';
  return new Promise((resolve) => {
    execFileImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true, timeout: 3000 }, (error, stdout) => {
      if (error) return resolve(null);
      resolve(parseBatteryOutput(stdout));
    });
  });
}

module.exports = { getBattery, parseBatteryOutput };
