import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildArtifacts, buildDictionary, compileEntry, parseAlignment, parsePronunciations, sha256, shardKey } from './build-dictionary.mjs';

const dictionary = buildDictionary();
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const policy = JSON.parse(read('data/policies/sound-cues.json'));
const teaching = JSON.parse(read('data/policies/teaching-groups.json'));
const base = phone => phone.replace(/[012]$/, '');

test('the named cue policy preserves per-phone source evidence, including the explicit schwa supplement', () => {
  const phones = read('data/upstream/cmudict.phones').trim().split('\n').map(line => line.split(/\s+/)[0]);
  for (const phone of [...phones, 'AH0', 'ER0']) {
    const row = policy.phoneCues[phone];
    assert.ok(row, `missing policy row: ${phone}`);
    if (row.status === 'documented') {
      assert.ok(['quick', 'stretch'].includes(row.cue));
      assert.ok((Number.isInteger(row.sourcePage) && row.sourcePage >= 2 && row.sourcePage <= 5) || (row.cueSource && row.sourceLocation));
      assert.ok(row.example);
    } else {
      assert.equal(row.status, 'unsupported'); assert.equal(row.cue, null); assert.ok(row.reason);
    }
  }
  assert.equal(policy.phoneCues.AH0.cue, 'quick');
  assert.equal(policy.phoneCues.AH0.cueSource, 'https://ufli.education.ufl.edu/resources/teaching-resources/glossary/');
  for (const phone of ['ER0', 'NG', 'TH', 'ZH']) assert.equal(policy.phoneCues[phone].cue, null);
});

test('reduced rhotic notation stays distinct and its unsupported cue stays withheld', () => {
  const entry = compileEntry('er', parseAlignment('e|r}ɜ|˞'), ['ER0'], { ER: 'vowel' }, policy);
  assert.equal(entry.sounds[0].phoneme, 'ɚ');
  assert.equal(entry.sounds[0].cue, null);
});

test('silent source spans are preserved and split-digraph units add noncontiguous relationships', () => {
  for (const word of ['cake', 'like', 'cute']) {
    const entry = dictionary.words[word];
    assert.equal(entry.groups.at(-1).text, 'e');
    assert.equal(entry.groups.at(-1).silent, true);
    assert.equal(entry.groups.at(-1).phoneme, '');
    assert.equal(entry.sounds.some(sound => sound.groupIndices.includes(entry.groups.length - 1)), false);
    const unit = entry.teachingUnits.find(unit => unit.patternId.startsWith('split-'));
    assert.deepEqual(unit.groupIndices, [1, 3]);
    assert.deepEqual(unit.letterIndices, [1, 3]);
    assert.equal(unit.evidence, teaching.reference);
  }
  assert.equal(dictionary.words.love.teachingUnits?.some(unit => unit.patternId.startsWith('split-')) ?? false, false);
  const knight = dictionary.words.knight;
  assert.equal(knight.groups.find(group => group.text === 'gh').silent, true);
  assert.ok(knight.provenance.alignment.some(segment => segment.raw === 'g|h}_'));
});

test('multiple phones retain ordered separate sound events linked to the same original span', () => {
  for (const [word, spelling, phones] of [['box', 'x', ['K', 'S']], ['cute', 'u', ['Y', 'UW1']], ['music', 'u', ['Y', 'UW1']]]) {
    const entry = dictionary.words[word];
    const groupIndex = entry.groups.findIndex(group => group.text === spelling);
    const events = entry.sounds.filter(sound => sound.groupIndices.includes(groupIndex));
    assert.deepEqual(events.map(sound => sound.arpabet), phones);
    assert.ok(events.every(sound => sound.groupIndices.length === 1));
    assert.equal(entry.groups[groupIndex].cue, null);
    assert.equal(events.every(sound => sound.cue === 'quick' || sound.cue === 'stretch'), true);
  }
});

test('an unsupported teaching cue remains a sound, while source epsilon has no event', () => {
  const entry = dictionary.words.thin;
  const unsupported = entry.sounds.find(sound => sound.arpabet === 'TH');
  assert.equal(unsupported.cue, null);
  assert.ok(unsupported.groupIndices.every(index => !entry.groups[index].silent));
  assert.equal(dictionary.words.cake.groups.at(-1).silent, true);
  assert.equal(dictionary.words.cake.sounds.some(sound => sound.groupIndices.includes(3)), false);
});

test('general teaching patterns replace all word-specific overlays without changing raw letter ownership', () => {
  assert.equal(Object.hasOwn(teaching, 'overrides'), false);
  assert.ok(teaching.patterns.length);
  for (const [word, pattern] of [['sheep', 'team-ee'], ['see', 'team-ee'], ['chip', 'team-ch'], ['boat', 'team-oa']]) {
    const entry = dictionary.words[word];
    assert.ok(entry.teachingUnits.some(unit => unit.patternId === pattern));
    assert.equal(entry.groups.map(group => group.text).join(''), word);
  }
  assert.equal(dictionary.words.hello.sounds[1].arpabet, 'AH0');
  assert.equal(dictionary.words.hello.sounds[1].phoneme, 'ə');
  assert.equal(dictionary.words.hello.sounds[1].cue, 'quick');
});

test('CMU agreement is necessary but misleading vowel-on-consonant ownership still needs review', () => {
  for (const word of ['apple', 'little', 'bottle', 'each', 'amplifier']) {
    assert.equal(dictionary.pronunciationOnly[word].reason, 'alignment-review');
    assert.equal(Object.hasOwn(dictionary.words, word), false);
  }
  assert.ok(dictionary.words.water.teachingUnits.some(unit => unit.patternId === 'team-er'));
  const segments = parseAlignment('s}s e}_ e}i');
  const classes = { S: 'fricative', IY: 'vowel', AE: 'vowel' };
  assert.equal(compileEntry('see', segments, ['S', 'IY1'], classes, policy).groups[1].silent, true);
  assert.throws(() => compileEntry('see', segments, ['S', 'AE1'], classes, policy), /disagree/);
  assert.throws(() => compileEntry('sea', segments, ['S', 'IY1'], classes, policy), /spelling differs/);
  assert.throws(() => compileEntry('see', segments, ['S', 'IY1'], classes, policy, { overrides: { see: {} } }), /Word-specific/);
});

test('full-source mapping conserves spelling, source epsilon, and every exact ordered CMU phone', () => {
  const { words, pronunciationOnly, counts } = dictionary;
  assert.equal(Object.getPrototypeOf(words), null);
  assert.equal(Object.getPrototypeOf(pronunciationOnly), null);
  assert.equal(counts.total, 126052);
  assert.equal(counts.complete, Object.keys(words).length);
  assert.ok(counts.complete > 100000, 'richer representation should improve whole-source coverage');
  assert.equal(counts.pronunciationOnly, Object.keys(pronunciationOnly).length);
  assert.equal(counts.total, counts.complete + counts.pronunciationOnly);
  assert.equal(counts.pronunciationOnly, counts.missingAlignment + counts.unresolvedAlignment + counts.alignmentReview);
  assert.equal(counts.sourceAlignments, 126046);
  assert.equal(counts.alternativePronunciations, 9114);
  assert.equal(counts.sourceSequenceAgreement, counts.complete + counts.alignmentReview + counts.unspannedSourceInsertions);
  assert.equal(counts.sourceAlignments, counts.sourceSequenceAgreement + counts.pronunciationDisagreement);
  assert.equal(counts.unresolvedAlignment, counts.unspannedSourceInsertions + counts.pronunciationDisagreement);
  const parsed = parsePronunciations(read('data/upstream/cmudict.dict'));
  for (const [word, entry] of Object.entries(words)) {
    assert.equal(entry.groups.map(group => group.text).join(''), word);
    assert.deepEqual(entry.sounds.map(sound => sound.arpabet), parsed.words.get(word));
    assert.equal(entry.groups.length, entry.provenance.alignment.length);
    for (const [index, group] of entry.groups.entries()) {
      assert.equal(group.text, entry.provenance.alignment[index].text);
      assert.equal(!!group.silent, entry.provenance.alignment[index].ipa === '');
      const sounds = entry.sounds.filter(sound => sound.groupIndices.includes(index));
      assert.equal(sounds.length === 0, !!group.silent);
      assert.equal(group.phoneme, sounds.map(sound => sound.phoneme).join(''));
    }
    for (const sound of entry.sounds) assert.ok(sound.groupIndices.every(index => Number.isInteger(index) && index >= 0 && index < entry.groups.length));
    const units = entry.teachingUnits ?? [];
    for (let left = 0; left < units.length; left++) for (let right = left + 1; right < units.length; right++) {
      if (units[left].groupIndices.some(index => units[right].groupIndices.includes(index))) assert.deepEqual(units[left].phoneIndices, units[right].phoneIndices, word + ': conflicting teaching units share a letter');
    }
  }
  assert.ok(Object.hasOwn(words, 'constructor') || Object.hasOwn(pronunciationOnly, 'constructor'));
  assert.equal(words.__proto__, undefined);
  assert.equal(pronunciationOnly.__proto__, undefined);
});

test('all CMU variants retain immutable IDs and exact stress without selecting a heteronym', () => {
  const parsed = parsePronunciations('read R EH1 D # primary\nread(2) R IY1 D\nconstructor K AH0 N\n');
  assert.deepEqual(parsed.words.get('read'), ['R', 'EH1', 'D']);
  assert.deepEqual(parsed.variants.get('read').map(variant => variant.id), ['read', 'read(2)']);
  assert.equal(parsed.alternativePronunciations, 1);
  assert.throws(() => parsePronunciations('word W ER1 D\nword W ER0 D'), /Duplicate primary/);
  assert.throws(() => parsePronunciations('word W invalid'), /Malformed CMU/);
  const readEntry = dictionary.words.read;
  assert.equal(readEntry.pronunciationAmbiguous, true);
  assert.equal(readEntry.primaryVariantId, 'read');
  assert.deepEqual(readEntry.variants.map(variant => variant.pronunciation), [['R', 'EH1', 'D'], ['R', 'IY1', 'D']]);
  assert.deepEqual(readEntry.variants.map(variant => variant.aligned), [true, false]);
  assert.equal(readEntry.variants[1].entry, undefined);
  let alternatives = 0;
  for (const entry of [...Object.values(dictionary.words), ...Object.values(dictionary.pronunciationOnly)]) {
    alternatives += entry.variants.length - 1;
    for (const variant of entry.variants) {
      assert.equal(variant.phonemes.length, variant.pronunciation.length);
      if (variant.entry) {
        assert.equal(variant.aligned, true);
        assert.deepEqual(variant.entry.sounds.map(sound => sound.arpabet), variant.pronunciation);
        if (entry.sounds) assert.deepEqual(variant.pronunciation.map(base), entry.sounds.map(sound => base(sound.arpabet)));
      }
    }
  }
  assert.equal(alternatives, 9114);
});

test('whole-pronunciation library graphs combine phones across raw source boundaries', () => {
  for (const word of ['day', 'may', 'way', 'wait']) {
    const entry = dictionary.words[word];
    const diphthongs = entry.sounds.filter(sound => sound.arpabet === 'EY1');
    assert.equal(diphthongs.length, 1, word + ': never duplicate one diphthong across two letter events');
    assert.deepEqual(diphthongs[0].groupIndices, [1, 2]);
    assert.equal(entry.groups[1].silent, undefined);
    assert.equal(entry.groups[2].silent, undefined);
    assert.ok(entry.teachingUnits.some(unit => ['team-ay', 'team-ai'].includes(unit.patternId)));
  }
  // NRC each really links part of CH to a; agreement is not teaching approval.
  assert.equal(dictionary.pronunciationOnly.each.reason, 'alignment-review');
  const graphs = JSON.parse(read('data/upstream/nrc-ipa-graphs.json')).pronunciations;
  assert.deepEqual(graphs.itʃ, [['IY', [0]], ['CH', [1, 2]]]);
  assert.deepEqual(graphs.deɪ, [['D', [0]], ['EY', [1, 2]]]);
});

test('vendored whole-IPA library graphs cover the full source with bounded token input indices', () => {
  const converted = JSON.parse(read('data/upstream/nrc-ipa-graphs.json'));
  const lock = JSON.parse(read('data/sources.lock.json'));
  assert.equal(sha256(read('data/upstream/nrc-ipa-graphs.json')), lock.ipaConversion.sha256);
  assert.equal(converted.schemaVersion, 2);
  assert.equal(converted.library.revision, lock.alignment.revision);
  assert.equal(converted.sourceAlignmentSha256, lock.alignment.sha256);
  assert.deepEqual(converted.pronunciations[''], []);
  for (const line of read('data/upstream/nrc-aligned.txt').trim().split('\n')) {
    const ipa = parseAlignment(line).map(segment => segment.ipa).join('');
    assert.ok(Object.hasOwn(converted.pronunciations, ipa));
  }
  for (const [ipa, events] of Object.entries(converted.pronunciations)) {
    if (!events) continue;
    const covered = new Set();
    for (const [phone, inputs] of events) {
      assert.match(phone, /^[A-Z]+$/);
      assert.ok(inputs.length);
      assert.deepEqual(inputs, [...new Set(inputs)].sort((a, b) => a - b));
      for (const input of inputs) { assert.ok(Number.isInteger(input) && input >= 0 && input < [...ipa].length); covered.add(input); }
    }
    assert.equal(covered.size, [...ipa].length);
  }
});

test('schema2 browser shards are deterministic, hashed and preserve every entry and sound relationship', () => {
  const { files, manifest } = buildArtifacts(dictionary);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(Object.keys(manifest.shards).length, 533);
  let total = 0, complete = 0;
  const seen = new Set();
  for (const [key, shard] of Object.entries(manifest.shards)) {
    const serialized = files.get(`public/${shard.path}`);
    assert.equal(sha256(serialized), shard.sha256);
    assert.equal(Buffer.byteLength(serialized), shard.bytes);
    const words = JSON.parse(serialized);
    assert.equal(Object.keys(words).length, shard.words);
    for (const [word, entry] of Object.entries(words)) {
      assert.equal(shardKey(word), key); assert.equal(seen.has(word), false); seen.add(word); total++;
      if (dictionary.words[word]?.variants.length > 1 || dictionary.pronunciationOnly[word]?.variants.length > 1) assert.ok(entry.variants.length);
      else assert.equal(entry.variants, undefined);
      if (entry.groups) {
        complete++;
        assert.equal(entry.groups.map(group => group.text).join(''), word);
        assert.deepEqual(entry.sounds.map(sound => sound.phoneme), dictionary.words[word].sounds.map(sound => sound.phoneme));
        for (const group of entry.groups) assert.ok(Object.keys(group).every(key => ['text', 'vowel', 'silent'].includes(key)));
        for (const sound of entry.sounds) assert.deepEqual(Object.keys(sound), ['phoneme', 'cue', 'vowel', 'groupIndices']);
      } else { assert.ok(['missing-alignment', 'unresolved-alignment', 'alignment-review'].includes(entry.reason)); assert.ok(entry.pronunciation.length); }
    }
  }
  assert.equal(total, manifest.counts.total);
  assert.equal(complete, manifest.counts.complete);
  assert.equal(shardKey('A'), 'a'); assert.equal(shardKey("a's"), 'a_'); assert.equal(shardKey("'bout"), '_b');
});
