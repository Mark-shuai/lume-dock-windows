const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '../renderer/assets/macos/generic.png')).toString('base64');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const records = JSON.parse(line).map(source => ({ source, icon }));
  process.stdout.write(JSON.stringify(records) + '\n');
});
