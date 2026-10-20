const { test } = require('node:test');
const assert = require('node:assert/strict');
const { indexNames, prepareQuery, score } = require('../renderer/app-search');
const match = (names, query) => score(indexNames(names), prepareQuery(query));

test('search ranks exact, prefix, word start, substring, acronym and compact subsequence', () => {
  const names = ['VSC', 'VSCodium', 'Launch VSC', 'AVSCopy', 'Visual Studio Code', 'Visual Scape'];
  const scores = names.map(name => match([name], 'vsc'));
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1] > scores[i], `${names[i - 1]} should precede ${names[i]}`);
  assert.ok(scores.at(-1) >= 0);
  assert.ok(match(['Google Chrome'], 'gchr') >= 0);
  assert.ok(match(['WindowsTerminal'], 'wt') >= 0, 'camel-case word boundaries');
  assert.ok(match(['Visual Studio Code'], 'vs') >= 0, 'two-letter acronym');
});

test('normalization, literal punctuation and Chinese queries stay predictable', () => {
  assert.ok(match(['Visual Studio Code'], ' ＶＳＣ ') >= 0);
  assert.ok(match(['Notepad++'], '++') >= 0);
  assert.ok(match(['微信'], '微信') > match(['微信开发者工具'], '微信'));
  assert.ok(match(['腾讯会议'], '会议') >= 0);
  assert.equal(match(['腾讯视频会议'], '腾讯会议'), -1, 'Chinese is not a fuzzy subsequence');
  assert.equal(match(['Visual Studio Code'], 'vc'), -1, 'two-letter scattered coincidence is rejected');
  assert.equal(match(['Visual Studio Code'], 'vxsc'), -1);
  assert.equal(match(['a' + 'x'.repeat(100) + 'bc'], 'abc'), -1, 'spread-out coincidence is rejected');
  assert.equal(match(['Steam'], '.*'), -1, 'query is text, never a regular expression');
  assert.equal(match(['Steam'], ''), 0);
});

test('all query tokens must match aliases and indexes are reusable without mutation', () => {
  const index = indexNames(['Visual Studio Code', '代码编辑器']);
  const before = JSON.stringify(index);
  assert.ok(score(index, prepareQuery('code 代码')) >= 0);
  assert.ok(score(index, prepareQuery('studio visual')) >= 0);
  assert.equal(score(index, prepareQuery('studio missing')), -1);
  assert.ok(score(index, prepareQuery('vsc')) >= 0);
  assert.equal(JSON.stringify(index), before);
  assert.equal(match(['Visual Studio', 'Code Viewer'], 'vsc'), -1, 'fuzzy letters cannot span unrelated aliases');
});
