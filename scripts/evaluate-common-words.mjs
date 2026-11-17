import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildDictionary, sha256 } from './build-dictionary.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const json = path => JSON.parse(read(path));

// The upstream cBpack subset uses only strings, positive integers, arrays and maps.
// No executable package or Python dependencies are needed to reproduce this sample.
export function readFrequencySource(bytes) {
  const buffer = gunzipSync(bytes);
  let offset = 0;
  const number = size => { const value = buffer.readUIntBE(offset, size); offset += size; return value; };
  const string = size => { const value = buffer.toString('utf8', offset, offset + size); offset += size; return value; };
  const array = size => Array.from({ length: size }, decode);
  const map = size => Object.fromEntries(Array.from({ length: size }, () => [decode(), decode()]));
  function decode() {
    const code = number(1);
    if (code <= 0x7f) return code;
    if ((code & 0xe0) === 0xa0) return string(code & 0x1f);
    if ((code & 0xf0) === 0x90) return array(code & 0x0f);
    if ((code & 0xf0) === 0x80) return map(code & 0x0f);
    if (code === 0xcc) return number(1);
    if (code === 0xcd) return number(2);
    if (code === 0xce) return number(4);
    if (code === 0xd9) return string(number(1));
    if (code === 0xda) return string(number(2));
    if (code === 0xdb) return string(number(4));
    if (code === 0xdc) return array(number(2));
    if (code === 0xdd) return array(number(4));
    throw new Error(`Unsupported MessagePack byte ${code.toString(16)}`);
  }
  const [header, ...bins] = decode();
  assert.deepEqual(header, { format: 'cB', version: 1 });
  assert.equal(offset, buffer.length);
  let sourceRank = 0;
  const eligible = [];
  for (const [bin, words] of bins.entries()) {
    for (const word of words) {
      sourceRank++;
      if (/^[a-z]+(?:'[a-z]+)*$/.test(word)) eligible.push({ rank: eligible.length + 1, sourceRank, word, zipf: Number((9 - bin / 100).toFixed(2)) });
      if (eligible.length === 500) return eligible;
    }
  }
  throw new Error('Fewer than 500 eligible English words');
}

export function assess(dictionary, word) {
  const entry = dictionary.words[word];
  if (!entry) return { word, status: dictionary.pronunciationOnly[word] ? 'pronunciation-only' : 'missing', reason: dictionary.pronunciationOnly[word]?.reason ?? 'missing-pronunciation', pronunciation: dictionary.pronunciationOnly[word]?.pronunciation ?? null, completeTeachingCues: false };
  const sounds = entry.sounds ?? entry.groups;
  const pronunciation = sounds.map(sound => sound.arpabet);
  assert.equal(entry.groups.map(group => group.text).join(''), word);
  assert.ok(sounds.length);
  assert.ok(sounds.every(sound => /^[A-Z]+[012]?$/.test(sound.arpabet)));
  const unsupportedPhones = [...new Set(sounds.filter(sound => sound.cue === null).map(sound => sound.arpabet))];
  return { word, status: 'mapped', pronunciation, completeTeachingCues: unsupportedPhones.length === 0, unsupportedPhones,
    groups: entry.groups.map(group => ({ text: group.text, arpabet: group.arpabet, silent: Boolean(group.silent) })),
    teachingUnits: (entry.teachingUnits ?? []).map(unit => unit.patternId) };
}

if (process.argv.includes('--extract-source')) {
  const path = process.argv[process.argv.indexOf('--extract-source') + 1];
  console.log(JSON.stringify({ sha256: sha256(readFileSync(path)), words: readFrequencySource(readFileSync(path)) }, null, 2));
} else {
  const sample = json('evaluation/common-words.json');
  assert.equal(sample.words.length, 500);
  assert.equal(new Set(sample.words.map(row => row.word)).size, 500);
  assert.ok(sample.words.every((row, index) => row.rank === index + 1 && /^[a-z]+(?:'[a-z]+)*$/.test(row.word)));
  if (process.argv.includes('--verify-frequency-source')) {
    const path = process.argv[process.argv.indexOf('--verify-frequency-source') + 1];
    const bytes = readFileSync(path);
    assert.equal(sha256(bytes), sample.source.sha256);
    assert.deepEqual(readFrequencySource(bytes), sample.words);
  }
  const dictionary = buildDictionary();
  const results = sample.words.map(row => ({ ...row, ...assess(dictionary, row.word) }));
  // Compare the selected phone sequence directly with the pinned primary CMU row.
  const primaryPhones = new Map(read('data/upstream/cmudict.dict').split('\n').flatMap(row => {
    const line = row.replace(/\s*#.*$/, '').trim();
    if (!line || line.startsWith(';;;')) return [];
    const [word, ...phones] = line.split(/\s+/);
    return /\(\d+\)$/.test(word) ? [] : [[word, phones]];
  }));
  for (const result of results) {
    assert.deepEqual(result.pronunciation, primaryPhones.get(result.word) ?? null, `${result.word}: primary source pronunciation changed`);
  }
  const totals = {
    words: results.length,
    mapped: results.filter(row => row.status === 'mapped').length,
    pronunciationOnly: results.filter(row => row.status === 'pronunciation-only').length,
    missing: results.filter(row => row.status === 'missing').length,
    completeTeachingCues: results.filter(row => row.completeTeachingCues).length,
  };
  assert.equal(totals.words, totals.mapped + totals.pronunciationOnly + totals.missing);
  const edgeCases = sample.edgeCases.map(({ word, concern }) => ({ ...assess(dictionary, word), concern }));
  const hello = dictionary.words.hello;
  const helloSchwa = (hello.sounds ?? hello.groups).find(sound => sound.arpabet === 'AH0');
  assert.equal(helloSchwa?.cue, 'quick', 'hello schwa requires the documented UFLI supplement');
  assert.equal(helloSchwa?.phoneme, 'ə');
  assert.deepEqual((dictionary.words.e.sounds ?? dictionary.words.e.groups).map(sound => [sound.arpabet, sound.cue]), [['IY1', 'stretch']]);
  const box = dictionary.words.box;
  const xGroup = box.groups.findIndex(group => group.text === 'x');
  assert.deepEqual(box.sounds.filter(sound => sound.groupIndices.includes(xGroup)).map(sound => [sound.arpabet, sound.cue]), [['K', 'quick'], ['S', 'stretch']]);
  assert.equal(dictionary.words.make.groups.at(-1).silent, true);
  assert.ok(dictionary.words.make.teachingUnits.some(unit => unit.patternId === 'split-a-e'));
  for (const word of ['apple', 'little', 'bottle', 'each', 'amplifier']) assert.equal(assess(dictionary, word).status, 'pronunciation-only', `${word}: risky source vowel-to-consonant alignment must be withheld`);
  const alternatives = new Set(read('data/upstream/cmudict.dict').split('\n').flatMap(line => {
    const match = line.match(/^([^\s]+)\(\d+\)\s/); return match ? [match[1]] : [];
  }));
  for (const word of ['day', 'wait']) {
    const event = dictionary.words[word].sounds.find(sound => sound.arpabet === 'EY1');
    assert.deepEqual(event.groupIndices, [1, 2], `${word}: graph must compose across raw source boundaries`);
  }
  const report = {
    purpose: 'Independent frequency sample for mapping and cue coverage; source agreement and structural checks are not a pedagogical correctness review.',
    source: sample.source, selection: sample.selection, baseline: sample.baseline,
    current: { ...totals, policyVersion: dictionary.policyVersion, cuePolicy: dictionary.cuePolicy, policySha256: sha256(read('data/policies/sound-cues.json')), builderSha256: sha256(read('scripts/build-dictionary.mjs')), sourceRevision: dictionary.sources.alignment.revision },
    sourcePronunciationChecksPassed: results.length,
    edgeChecks: ['hello AH0 is ə with sourced quick cue', 'letter e is IY1 stretch', 'box x retains K quick + S stretch', 'make retains silent e and split-a-e teaching unit', 'apple/little/bottle risky source alignments withheld'],
    gain: { mapped: totals.mapped - sample.baseline.mapped, completeTeachingCues: totals.completeTeachingCues - sample.baseline.completeTeachingCues },
    knownHeteronyms: sample.knownHeteronyms.filter(word => sample.words.some(row => row.word === word)),
    wordsWithNumberedCmuAlternatives: sample.words.filter(row => alternatives.has(row.word)).map(row => row.word),
    limits: [
      'This is the first 500 eligible tokens in the pinned wordfreq English large list; not a universal top-500 list, a reading curriculum, or a child-frequency corpus.',
      'CMUdict primary pronunciation is selected without context; numbered alternatives include dialect and reduction variants as well as heteronyms.',
      'Mapped means the source spelling and phoneme sequence pass importer checks. It does not certify every grapheme choice as suitable teaching material.',
      'Complete teaching cues means every selected phone has documented quick/stretch evidence; missing cue evidence does not mean uncertain pronunciation or silence.',
      'The generic alignment review gate withholds some implausible vowel-to-consonant assignments, but it is not a complete human review of source alignments.',
    ],
    edgeCases, results,
  };
  const missingCues = [...new Set(results.flatMap(row => row.unsupportedPhones ?? []))].sort();
  const outputs = { 'evaluation/common-words-report.json': JSON.stringify(report, null, 2) + '\n' };
  for (const [path, value] of Object.entries(outputs)) {
    if (process.argv.includes('--check')) assert.equal(read(path), value, `${path} is stale`);
    else writeFileSync(new URL(path, root), value);
  }
  console.log(JSON.stringify({ ...totals, gain: report.gain, unsupportedPhones: missingCues }, null, 2));
}
