import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tokenize, hasBlendingCues } from '../src/model.ts';
import { buildDictionary } from './build-dictionary.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const cases = JSON.parse(read('evaluation/sentences.json'));
const dictionary = buildDictionary();
const policy = JSON.parse(read('data/policies/sound-cues.json'));
const allPhones = read('data/upstream/cmudict.phones').trim().split('\n').map(line => line.split(/\s+/)[0]);
assert.equal(cases.length, 100);
assert.equal(new Set(cases.map(row => row.text)).size, 100);

// Independently written known-word expectations guard the policy change.
const expected = {
  dad: [['d', 'D', 'quick'], ['a', 'AE1', 'stretch'], ['d', 'D', 'quick']],
  she: [['sh', 'SH', 'stretch'], ['e', 'IY1', 'stretch']],
  hello: [['h', 'HH', 'quick'], ['e', 'AH0', null], ['ll', 'L', 'stretch'], ['o', 'OW1', 'stretch']],
  book: [['b', 'B', 'quick'], ['oo', 'UH1', 'stretch'], ['k', 'K', 'quick']],
  sheep: [['sh', 'SH', 'stretch'], ['ee', 'IY1', 'stretch'], ['p', 'P', 'quick']],
};
for (const [word, groups] of Object.entries(expected)) {
  assert.deepEqual(dictionary.words[word].groups.map(g => [g.text, g.arpabet, g.cue]), groups);
}

const exercised = new Set();
const exactPhones = new Set();
const exercisedCueRows = new Set();
const exercisedWords = new Set();
const withheld = new Set();
const results = cases.map(row => {
  const tokens = tokenize(row.text);
  assert.equal(tokens.map(token => token.text).join(''), row.text);
  const words = tokens.filter(token => token.word);
  const unknown = new Set();
  let mapped = 0;
  let pronunciationOnly = 0;
  let completeRails = 0;
  const deferredCues = [];
  for (const token of words) {
    const key = token.text.toLowerCase();
    const entry = dictionary.words[key];
    if (!entry) { unknown.add(key); if (Object.hasOwn(dictionary.pronunciationOnly, key)) pronunciationOnly++; continue; }
    exercisedWords.add(key);
    mapped++;
    assert.equal(entry.groups.map(group => group.text).join(''), key);
    for (const group of entry.groups) {
      const base = group.arpabet.replace(/[012]$/, '');
      exercised.add(base);
      exactPhones.add(group.arpabet);
      exercisedCueRows.add(Object.hasOwn(policy.phoneCues, group.arpabet) ? group.arpabet : base);
      const reference = policy.phoneCues[group.arpabet] ?? policy.phoneCues[base];
      assert.ok(reference, `${key}: unaccounted policy phone`);
      assert.equal(group.cue, reference.cue);
      if (reference.status === 'unsupported') {
        assert.equal(group.cue, null);
        withheld.add(group.arpabet);
        deferredCues.push({ word: key, letters: group.text, phone: group.arpabet });
      } else {
        assert.ok(['quick', 'stretch'].includes(group.cue));
        assert.equal(group.cueSourcePage, reference.sourcePage);
      }
    }
    if (hasBlendingCues(entry)) completeRails++;
    else assert.ok(entry.groups.some(group => group.cue === null), 'An incomplete cue set must correspond to an explicitly unsupported cue.');
  }

  if (row.kind === 'supported-vocabulary') assert.equal(mapped, words.length);
  return { id: row.id, text: row.text, kind: row.kind, words: words.length, mappedWords: mapped, pronunciationOnly, completeBlendRails: completeRails, unmapped: [...unknown], deferredCues, status: 'checks-passed' };
});
const report = {
  purpose: 'Conformance and coverage checks; sentence generation is not independent proof of educational correctness.',
  cuePolicy: policy.policyId,
  total: results.length,
  supportedVocabularyCases: results.filter(row => row.kind === 'supported-vocabulary').length,
  coverageChallenges: results.filter(row => row.kind === 'coverage-challenge').length,
  passed: results.length,
  wordOccurrences: results.reduce((sum, row) => sum + row.words, 0),
  pronunciationOnlyOccurrences: results.reduce((sum, row) => sum + row.pronunciationOnly, 0),
  mappedOccurrences: results.reduce((sum, row) => sum + row.mappedWords, 0),
  completeBlendRails: results.reduce((sum, row) => sum + row.completeBlendRails, 0),
  exercisedWords: [...exercisedWords].sort(),
  exercisedBasePhones: [...exercised].sort(),
  unexercisedBasePhones: allPhones.filter(phone => !exercised.has(phone)),
  explicitlyWithheldPhones: [...withheld].sort(),
  exactPhones: [...exactPhones].sort(),
  exercisedCueRows: [...exercisedCueRows].sort(),
  unexercisedCueRows: Object.keys(policy.phoneCues).filter(phone => !exercisedCueRows.has(phone)).sort(),
  cases: results,
};
const serialized = JSON.stringify(report, null, 2) + '\n';
const markdown = '# 100 generated sentence cases\n\n' +
  'Mapping and complete cue coverage are separate. Unclassified sounds display ? alongside documented cues; they are not silent. These checks do not establish educational efficacy.\n\n' +
  '| ID | Sentence | Mapped words | Complete rails | Outside dictionary |\n| --- | --- | --- | --- | --- |\n' +
  results.map(row => `| ${row.id} | ${row.text} | ${row.mappedWords}/${row.words} | ${row.completeBlendRails}/${row.words} | ${row.unmapped.join(', ') || '—'} |`).join('\n') + '\n';
if (process.argv.includes('--check')) {
  assert.equal(read('evaluation/report.json'), serialized, 'Sentence evaluation report is stale.');
  assert.equal(read('evaluation/sentences.md'), markdown, 'Sentence review table is stale.');
} else {
  writeFileSync(new URL('evaluation/report.json', root), serialized);
  writeFileSync(new URL('evaluation/sentences.md', root), markdown);
}
console.log(JSON.stringify({ total: report.total, passed: report.passed, wordOccurrences: report.wordOccurrences, mappedOccurrences: report.mappedOccurrences, completeBlendRails: report.completeBlendRails, exercisedWords: report.exercisedWords.length, exercisedBasePhones: report.exercisedBasePhones.length, unexercisedBasePhones: report.unexercisedBasePhones, withheld: report.explicitlyWithheldPhones }, null, 2));
