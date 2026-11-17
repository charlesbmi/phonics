import assert from 'node:assert/strict';
import test from 'node:test';
import { tokenize, hintsVisible, soundAtClientX, hasBlendingCues } from './model.ts';

import { buildDictionary } from '../scripts/build-dictionary.mjs';
const dictionary = buildDictionary();

test('repeated words retain separate occurrences and exact original text', () => {
  const source = "Dad, Dad!\nShe sees café. It's hello.";
  const tokens = tokenize(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.deepEqual(tokens.filter(token => token.word).map(token => [token.text, token.occurrence]), [
    ['Dad', 0], ['Dad', 1], ['She', 2], ['sees', 3], ['café', 4], ["It's", 5], ['hello', 6],
  ]);
});

test('per-occurrence Show and Hide override the global default', () => {
  assert.equal(hintsVisible(false, 'show'), true);
  assert.equal(hintsVisible(true, 'hide'), false);
  assert.equal(hintsVisible(true, 'default'), true);
  assert.equal(hintsVisible(false, 'default'), false);
});

test('scrubbing follows unequal grapheme widths and clamps beyond endpoints', () => {
  const rightEdges = [30, 90, 120];
  assert.equal(soundAtClientX(-20, rightEdges), 0);
  assert.equal(soundAtClientX(35, rightEdges), 1);
  assert.equal(soundAtClientX(80, rightEdges), 1);
  assert.equal(soundAtClientX(120, rightEdges), 2);
  assert.equal(soundAtClientX(160, rightEdges), 2);
});

test('dictionary entries cover their spelling with explicit supported cue data', () => {
  for (const [word, entry] of Object.entries(dictionary.words)) {
    assert.equal(entry.groups.map(group => group.text).join(''), word);
    assert.ok(entry.groups.length > 0);
    for (const group of entry.groups) {
      assert.ok([null, 'quick', 'stretch'].includes(group.cue), `${word}: invalid cue`);
      assert.ok(group.phoneme.length > 0, `${word}: missing phoneme`);
      assert.ok([null, 'short', 'long', 'reduced', 'other'].includes(group.vowel));
    }
  }
  // Duration and conventional long-vowel marks encode different things.
  assert.equal(dictionary.words.dad.groups[1].cue, 'stretch');
  assert.equal(dictionary.words.dad.groups[1].vowel, 'short');
  assert.equal(dictionary.words.moon.groups[1].vowel, 'other');
  assert.equal(hasBlendingCues(dictionary.words.sheep), true);
  assert.equal(hasBlendingCues(dictionary.words.hello), false);
  assert.equal(hasBlendingCues(undefined), false);
});
