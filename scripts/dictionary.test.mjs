import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildArtifacts, buildDictionary, compileEntry, parseAlignment, parsePronunciations, sha256, shardKey } from './build-dictionary.mjs';

const dictionary = buildDictionary();
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
  const { words } = dictionary;
  assert.equal(Object.keys(words).length, 51801);
  assert.deepEqual(words.sheep.groups.map(g => [g.text, g.arpabet]), [['sh', 'SH'], ['ee', 'IY1'], ['p', 'P']]);
  assert.deepEqual(words.chip.groups.map(g => [g.text, g.arpabet]), [['ch', 'CH'], ['i', 'IH1'], ['p', 'P']]);
  assert.deepEqual(words.boat.groups.map(g => [g.text, g.arpabet]), [['b', 'B'], ['oa', 'OW1'], ['t', 'T']]);
  assert.equal(words.hello.groups[1].arpabet, 'AH0');
  assert.equal(words.hello.groups[1].phoneme, 'ə');
  assert.equal(words.sheep.provenance.teachingAdjustment.includes('ee vowel team'), true);
});

test('sound class and stress distinguish instructional duration from conventional vowel names', () => {
  const { words } = dictionary;
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


test('the full pinned vocabulary is partitioned into validated mappings and explicit review gaps', () => {
  const { words, pronunciationOnly, counts } = dictionary;
  assert.equal(Object.getPrototypeOf(words), null);
  assert.equal(Object.getPrototypeOf(pronunciationOnly), null);
  assert.equal(counts.total, 126052);
  assert.equal(counts.complete, Object.keys(words).length);
  assert.equal(counts.pronunciationOnly, Object.keys(pronunciationOnly).length);
  assert.equal(counts.total, counts.complete + counts.pronunciationOnly);
  assert.equal(counts.pronunciationOnly, counts.missingAlignment + counts.unresolvedAlignment);
  assert.equal(counts.sourceAlignments, 126046);
  assert.equal(counts.alternativePronunciations, 9114);
  for (const word of ['dog', 'mom', 'happy', 'banana']) {
    assert.ok(Object.hasOwn(words, word), `${word}: automatic full-source mapping absent`);
  }
  for (const word of ['apple', 'cake', 'love', 'read', 'water', 'what', 'you']) {
    assert.equal(pronunciationOnly[word].reason, 'unresolved-alignment');
    assert.ok(pronunciationOnly[word].pronunciation.length);
    assert.equal(Object.hasOwn(words, word), false);
  }
  assert.ok(Object.hasOwn(words, 'constructor') || Object.hasOwn(pronunciationOnly, 'constructor'));
  assert.equal(Object.hasOwn(words, '__proto__'), false);
  assert.equal(words.__proto__, undefined);
  assert.equal(pronunciationOnly.__proto__, undefined);
});

test('primary pronunciation parsing strips CMU metadata and never selects numbered alternatives', () => {
  const parsed = parsePronunciations('read R EH1 D # primary\nread(2) R IY1 D\nconstructor K AH0 N\n');
  assert.deepEqual(parsed.words.get('read'), ['R', 'EH1', 'D']);
  assert.equal(parsed.words.has('read(2)'), false);
  assert.equal(parsed.alternativePronunciations, 1);
  assert.deepEqual(parsed.words.get('constructor'), ['K', 'AH0', 'N']);
  assert.throws(() => parsePronunciations('word W ER1 D\nword W ER0 D'), /Duplicate primary/);
  assert.throws(() => parsePronunciations('word W invalid'), /Malformed CMU/);
});

test('browser shards are compact, deterministic, hashed and account for every dictionary entry', () => {
  const { files, manifest } = buildArtifacts(dictionary);
  assert.equal(Object.keys(manifest.shards).length, 533);
  let total = 0;
  let complete = 0;
  let pronunciationOnly = 0;
  const seen = new Set();
  for (const [key, shard] of Object.entries(manifest.shards)) {
    const serialized = files.get(`public/${shard.path}`);
    assert.equal(sha256(serialized), shard.sha256);
    assert.equal(Buffer.byteLength(serialized), shard.bytes);
    const words = JSON.parse(serialized);
    assert.equal(Object.keys(words).length, shard.words);
    for (const [word, entry] of Object.entries(words)) {
      assert.equal(shardKey(word), key);
      assert.equal(seen.has(word), false);
      seen.add(word);
      total++;
      if (entry.groups) {
        complete++;
        assert.equal(entry.groups.map(group => group.text).join(''), word);
        for (const group of entry.groups) assert.deepEqual(Object.keys(group), ['text', 'phoneme', 'cue', 'vowel']);
      } else {
        pronunciationOnly++;
        assert.ok(['missing-alignment', 'unresolved-alignment'].includes(entry.reason));
        assert.ok(entry.pronunciation.length);
      }
    }
  }
  assert.equal(total, manifest.counts.total);
  assert.equal(complete, manifest.counts.complete);
  assert.equal(pronunciationOnly, manifest.counts.pronunciationOnly);
  assert.equal(shardKey('A'), 'a');
  assert.equal(shardKey("a's"), 'a_');
  assert.equal(shardKey("'bout"), '_b');
});
