import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDictionary, compileEntry, compileReviewEntry, parseAlignment, phoneNotation, sha256 } from './build-dictionary.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const json = path => JSON.parse(read(path));

// Review artifacts are separate from the admitted lexicon. Candidates retain
// the original source ownership and never become normal dictionary entries.
export function buildAlignmentReview() {
  const dictionary = buildDictionary();
  const sample = json('evaluation/common-words.json');
  const policy = json('data/policies/sound-cues.json');
  const teaching = json('data/policies/teaching-groups.json');
  const conversion = json('data/upstream/nrc-ipa-graphs.json');
  const phoneClasses = Object.fromEntries(read('data/upstream/cmudict.phones').trim().split('\n').map(line => line.trim().split(/\s+/)));
  const alignments = new Map(read('data/upstream/nrc-aligned.txt').trim().split('\n').map(line => {
    const segments = parseAlignment(line);
    return [segments.map(segment => segment.text).join(''), segments];
  }));
  const words = sample.words.filter(({ word }) => !dictionary.words[word]).map(({ word, rank }) => {
    const admitted = dictionary.pronunciationOnly[word];
    assert.ok(admitted, `${word}: review requires a known primary pronunciation`);
    const segments = alignments.get(word) ?? [];
    let reason = 'No NRC source alignment is available.';
    try {
      if (segments.length) compileEntry(word, segments, admitted.pronunciation, phoneClasses, policy, teaching);
    } catch (error) { reason = error.message.replace(`${word}: `, ''); }
    let candidate = null;
    if (admitted.reason === 'alignment-review') {
      candidate = compileReviewEntry(word, segments, admitted.pronunciation, phoneClasses, policy, teaching);
      assert.equal(candidate.groups.map(group => group.text).join(''), word);
      assert.deepEqual(candidate.provenance.alignment, segments, `${word}: review changed source ownership`);
    }
    const sourceGraph = conversion.pronunciations[segments.map(segment => segment.ipa).join('')];
    return {
      word, rank, reason, reasonCode: admitted.reason,
      pronunciation: admitted.pronunciation,
      phonemes: admitted.pronunciation.map(phone => phoneNotation(phone, policy)),
      sourceSegments: segments,
      sourcePhones: sourceGraph?.map(([phone]) => phone) ?? null,
      candidate: candidate ? { groups: candidate.groups, sounds: candidate.sounds, ...(candidate.teachingUnits ? { teachingUnits: candidate.teachingUnits } : {}) } : null,
    };
  });
  assert.equal(words.length, 37, 'Common-word review set changed; review its scope before regenerating');
  return {
    schemaVersion: 1,
    id: sha256(JSON.stringify({ sources: dictionary.sources, policy, teaching, words })),
    purpose: 'Unapproved source alignments for local visual feedback. No review decision changes or publishes the dictionary.',
    source: { pronunciation: 'CMUdict primary pronunciation', alignment: 'NRC g2p English IPA source alignment', frequency: sample.source, sources: dictionary.sources },
    words,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], 'file://' + process.cwd() + '/'))) {
  const output = JSON.stringify(buildAlignmentReview()) + '\n';
  const path = 'public/review/alignments.json';
  if (process.argv.includes('--check')) assert.equal(read(path), output, 'Alignment review data is stale');
  else {
    mkdirSync(new URL('public/review/', root), { recursive: true });
    writeFileSync(new URL(path, root), output);
  }
  console.log('Alignment review: 37 unmarked words; normal lexicon unchanged.');
}
