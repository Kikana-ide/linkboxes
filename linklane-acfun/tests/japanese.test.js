'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/japanese-questions.js'), 'utf8'), context);
const papers = JSON.parse(JSON.stringify(context.JLPT_PAPERS));

test('all five levels have complete original short papers and valid answer keys', () => {
  assert.deepEqual(papers.map(paper => paper.level), ['N5', 'N4', 'N3', 'N2', 'N1']);
  const ids = new Set();
  for (const paper of papers) {
    assert.equal(paper.durationMinutes, 30);
    assert.equal(paper.questions.length, 24);
    for (const section of ['词汇', '语法', '阅读']) {
      assert.equal(paper.questions.filter(question => question.section === section).length, 8);
    }
    const passages = new Map();
    for (const question of paper.questions) {
      assert.ok(!ids.has(question.id), `duplicate question id: ${question.id}`);
      ids.add(question.id);
      assert.equal(question.options.length, 4, question.id);
      assert.equal(new Set(question.options).size, 4, `duplicate options: ${question.id}`);
      assert.ok(Number.isInteger(question.answer) && question.answer >= 0 && question.answer < 4, question.id);
      assert.ok(question.prompt.trim() && question.explanation.trim(), question.id);
      if (question.section === '阅读') {
        assert.ok(question.passage.length >= 60, `missing reading passage: ${question.id}`);
        passages.set(question.passage, (passages.get(question.passage) || 0) + 1);
      }
    }
    assert.equal(passages.size, 4, paper.level);
    assert.ok([...passages.values()].every(count => count === 2), paper.level);
  }
  assert.equal(ids.size, 120);
});

test('Vercel routes preserve AcFun and add both Japanese URL forms without an API catch-all', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
  assert.equal(config.functions['api/parse.js'].maxDuration, 20);
  assert.equal(config.functions['api/download.js'].maxDuration, 300);
  for (const route of ['acfun', 'japanese']) {
    for (const suffix of ['', '/']) {
      assert.ok(config.rewrites.some(item => item.source === `/${route}${suffix}` && item.destination === `/${route}/index.html`));
    }
  }
  assert.ok(config.rewrites.every(item => /^\/(acfun|japanese)\/?$/.test(item.source)));
});
