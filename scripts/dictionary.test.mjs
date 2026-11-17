import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDictionary, compileEntry, parseAlignment } from './build-dictionary.mjs';

const policy = JSON.parse(readFileSync(new URL('../data/policies/sound-cues.json', import.meta.url), 'utf8'));

test('the named cue policy accounts for every CMU phone and preserves explicit evidence gaps', () => {
  const phones = readFileSync(new URL('../data/upstream/cmudict.phones', import.meta.url), 'utf8').trim().split('\n').map(line => line.split(/\s+/)[0]);
  for (const phone of [...phones, 'AH0', 'ER0']) {
    const row = policy.phoneCues[phone];
    assert.ok(row, `missing policy row: ${phone}`);
    if (row.status === 'documented') {
      assert.ok(['quick', 'stretch'].includes(row.cue));
      assert.ok(Number.isInteger(row.sourcePage) && row.sourcePage >= 2 && row.sourcePage <= 5);
      assert.ok(row.example);
    } else {
      assert.equal(row.status, 'unsupported');
      assert.equal(row.cue, null);
      assert.ok(row.reason);
    }
  }
  for (const phone of ['HH', 'CH', 'JH']) assert.equal(policy.phoneCues[phone].cue, 'quick');
  for (const phone of ['W', 'Y', 'UH', 'UW', 'DH']) assert.equal(policy.phoneCues[phone].cue, 'stretch');
  for (const phone of ['AH0', 'ER0', 'NG', 'TH', 'ZH']) assert.equal(policy.phoneCues[phone].cue, null);
});

test('reduced rhotic notation is distinct and its unsupported teaching cue stays withheld', () => {
  const entry = compileEntry('er', parseAlignment('e|r}ɜ|˞'), ['ER0'], { ER: 'vowel' }, policy);
  assert.equal(entry.groups[0].phoneme, 'ɚ');
  assert.equal(entry.groups[0].cue, null);
});

test('pronunciation comes from pinned sources while teaching teams preserve their sounds', () => {
  const { words } = buildDictionary();
  assert.equal(Object.keys(words).length, 22);
  assert.deepEqual(words.sheep.groups.map(g => [g.text, g.arpabet]), [['sh', 'SH'], ['ee', 'IY1'], ['p', 'P']]);
  assert.deepEqual(words.chip.groups.map(g => [g.text, g.arpabet]), [['ch', 'CH'], ['i', 'IH1'], ['p', 'P']]);
  assert.deepEqual(words.boat.groups.map(g => [g.text, g.arpabet]), [['b', 'B'], ['oa', 'OW1'], ['t', 'T']]);
  assert.equal(words.hello.groups[1].arpabet, 'AH0');
  assert.equal(words.hello.groups[1].phoneme, 'ə');
  assert.equal(words.sheep.provenance.teachingAdjustment.includes('ee vowel team'), true);
});

test('sound class and stress distinguish instructional duration from conventional vowel names', () => {
  const { words } = buildDictionary();
  assert.equal(words.dad.groups[0].phoneClass, 'stop');
  assert.equal(words.dad.groups[0].cue, 'quick');
  assert.equal(words.dad.groups[1].cue, 'stretch');
  assert.equal(words.dad.groups[1].vowel, 'short');
  assert.equal(words.she.groups[0].phoneClass, 'fricative');
  assert.equal(words.she.groups[0].cue, 'stretch');
  assert.equal(words.she.groups[1].vowel, 'long');
  assert.equal(words.hello.groups[0].phoneClass, 'aspirate');
  assert.equal(words.hello.groups[0].cue, 'quick');
  assert.equal(words.a.groups[0].vowel, 'reduced');
  assert.equal(words.a.groups[0].cue, null);
  assert.equal(words.hello.groups[1].cueStatus, 'unsupported');
  assert.equal(words.hello.groups[0].cueSourcePage, 2);
  assert.equal(words.book.groups[1].vowel, 'other');
  assert.equal(words.moon.groups[1].vowel, 'other');
});

test('unresolved alignment, changed pronunciation and invalid overlays fail closed', () => {
  const segments = parseAlignment('s}s e}_ e}i');
  const classes = { S: 'fricative', IY: 'vowel', AE: 'vowel' };
  assert.throws(() => compileEntry('see', segments, ['S', 'IY1'], classes, policy), /requires explicit review/);
  assert.throws(() => compileEntry('see', segments, ['S', 'AE1'], classes, policy, { groups: [[0], [1, 2]] }), /disagree/);
  assert.throws(() => compileEntry('see', segments, ['S', 'IY1'], classes, policy, { groups: [[0], [2, 1]] }), /exactly once and in order/);
  assert.throws(() => compileEntry('sea', segments, ['S', 'IY1'], classes, policy, { groups: [[0], [1, 2]] }), /spelling differs/);
});
