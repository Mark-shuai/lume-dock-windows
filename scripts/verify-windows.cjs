const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function optionsFor(args) {
  const options = { minutes: 60, cycles: 100, intervalSeconds: 30, smoke: false };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--smoke') options.smoke = true;
    else if (key === '--quick') options.minutes = 0;
    else {
      const name = { '--minutes': 'minutes', '--cycles': 'cycles', '--interval': 'intervalSeconds' }[key];
      if (!name || args[i + 1] === undefined) throw new Error('Unknown or incomplete option: ' + key);
      options[name] = Number(args[++i]);
    }
  }
  if (!Number.isFinite(options.minutes) || options.minutes < 0 || options.minutes > 1440 ||
    !Number.isInteger(options.cycles) || options.cycles < 1 || options.cycles > 1000 ||
    !Number.isFinite(options.intervalSeconds) || options.intervalSeconds < 5 || options.intervalSeconds > 300) throw new Error('Invalid duration, cycle count or sample interval');
  if (options.smoke) Object.assign(options, { minutes: 0, cycles: 8 });
  return options;
}

function run() {
  const options = optionsFor(process.argv.slice(2));
  if (process.platform !== 'win32' && !options.smoke) throw new Error('Windows validation requires Windows 11. --smoke runs synthetic host checks only.');
  const root = path.join(__dirname, '..');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.join(root, 'reports', 'windows-' + stamp);
  fs.mkdirSync(output, { recursive: true });
  const report = { version: require('../package.json').version, startedAt: new Date().toISOString(), platform: process.platform,
    mode: options.smoke ? 'synthetic-smoke' : 'windows-native-development', options, suites: [], status: 'running' };
  const save = () => fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
  save();
  const electron = require('electron');
  const suites = options.smoke ? [] : [
    ['unit', process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.cjs')).map(file => 'tests/' + file)]],
    ['native-icons', electron, ['tests/windows-icons-native.cjs']],
    ['performance', electron, ['tests/performance-ui.cjs']],
    ['stability', electron, ['tests/stability-ui.cjs']],
    ['quit', process.execPath, ['tests/quit-runner.cjs']],
    ['upgrade-logic', process.execPath, ['tests/upgrade-runner.cjs']],
  ];
  suites.push(['soak', electron, ['tests/windows-soak.cjs']]);
  for (const [name, executable, args] of suites) {
    console.log('Running ' + name + '... Reports: ' + output);
    const env = { ...process.env, LUME_SOAK_OPTIONS: JSON.stringify(options), LUME_SOAK_REPORT: path.join(output, 'soak.json') };
    // The GUI application must not inherit Electron's Node-only mode.
    if (executable === electron) delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(executable, args, { cwd: root, env, encoding: 'utf8', windowsHide: false,
      maxBuffer: 16 * 1024 * 1024, timeout: name === 'soak' ? options.minutes * 60000 + 300000 : 180000 });
    fs.writeFileSync(path.join(output, name + '.log'), (result.stdout || '') + (result.stderr || '') + (result.error ? '\n' + result.error.message : ''));
    let passed = result.status === 0 && !result.error;
    if (name === 'soak') {
      try { passed &&= JSON.parse(fs.readFileSync(path.join(output, 'soak.json'), 'utf8')).status === 'passed'; }
      catch { passed = false; }
    }
    report.suites.push({ name, passed, exitCode: result.status });
    save();
    if (!passed) { report.status = 'failed'; report.failedSuite = name; break; }
    console.log(name + ' passed.');
  }
  if (report.status === 'running') report.status = 'passed';
  report.finishedAt = new Date().toISOString();
  if (report.status === 'passed') report.nextStep = 'Validate the packaged installer, original-path upgrade, tray quit, sleep/resume and actual desktop behavior manually on Windows 11.';
  save(); console.log(report.status.toUpperCase() + ': ' + path.join(output, 'summary.json'));
  if (report.status !== 'passed') process.exitCode = 1;
}
if (require.main === module) { try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { optionsFor };
