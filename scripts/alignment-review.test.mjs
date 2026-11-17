import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildAlignmentReview } from './build-alignment-review.mjs';

const root = new URL('../', import.meta.url);
const review = buildAlignmentReview();
const readJson = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

test('review artifact exactly matches the 37 withheld common words', () => {
  assert.deepEqual(readJson('public/review/alignments.json'), review);
  assert.equal(review.words.length, 37);
  assert.equal(new Set(review.words.map(row => row.word)).size, 37);
  const report = readJson('evaluation/common-words-report.json');
  assert.deepEqual(review.words.map(row => row.word), report.results.filter(row => row.status !== 'mapped').map(row => row.word));
});

test('review candidates preserve source spans and primary pronunciation while normal shards stay unmarked', () => {
  const graphs = readJson('data/upstream/nrc-ipa-graphs.json').pronunciations;
  let candidates = 0;
  for (const row of review.words) {
    const key = row.word.slice(0, 2).replace(/[^a-z]/g, '_');
    const admitted = readJson(`public/lexicon/shards/${key}.json`)[row.word];
    assert.ok(admitted.pronunciation, `${row.word}: normal lexicon must remain pronunciation-only`);
    assert.equal(admitted.groups, undefined);
    if (!row.candidate) {
      assert.notEqual(row.reasonCode, 'alignment-review', `${row.word}: ownership review should have its source candidate`);
      assert.ok(row.sourceSegments.some(span => !span.text), `${row.word}: insertion must have an explicit source span`);
      continue;
    }
    candidates++;
    assert.equal(row.reasonCode, 'alignment-review');
    assert.deepEqual(row.candidate.groups.map(group => group.text), row.sourceSegments.map(span => span.text));
    assert.deepEqual(row.candidate.sounds.map(sound => sound.arpabet), row.pronunciation);
    const sourceOwners = row.sourceSegments.flatMap((span, index) => Array.from(span.ipa, () => index));
    const graph = graphs[row.sourceSegments.map(span => span.ipa).join('')];
    assert.deepEqual(row.candidate.sounds.map(sound => sound.groupIndices), graph.map(([, inputs]) => [...new Set(inputs.map(input => sourceOwners[input]))].sort((a, b) => a - b)), `${row.word}: review must not reassign a sound to other letters`);
    assert.equal(row.candidate.groups.map(group => group.text).join(''), row.word);
    row.candidate.groups.forEach((group, index) => assert.equal(Boolean(group.silent), row.sourceSegments[index].ipa === ''));
  }
  assert.equal(candidates, 26);
});
