import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const json = path => JSON.parse(read(path));
export const sha256 = text => createHash('sha256').update(text).digest('hex');
const sourceFiles = { cmudict: 'data/upstream/cmudict.dict', alignment: 'data/upstream/nrc-aligned.txt', phoneClasses: 'data/upstream/cmudict.phones' };

// An alignment review gap is expected data coverage, unlike invalid policy or damaged source files.
class AlignmentReviewError extends Error {}
const needsReview = message => { throw new AlignmentReviewError(message); };

export function parseAlignment(line) {
  return line.trim().split(/\s+/).map(pair => {
    const parts = pair.split('}');
    if (parts.length !== 2) throw new Error(`Malformed alignment: ${pair}`);
    return { text: parts[0].replaceAll('|', '').replaceAll('_', ''), ipa: parts[1].replaceAll('|', '').replaceAll('_', '') };
  });
}

export function compileEntry(word, segments, pronunciation, phoneClasses, policy, adjustment) {
  if (segments.map(segment => segment.text).join('') !== word) throw new Error(`${word}: alignment spelling differs`);
  const indices = adjustment?.groups ?? segments.map((_, index) => [index]);
  if (JSON.stringify(indices.flat()) !== JSON.stringify(segments.map((_, index) => index))) {
    throw new Error(`${word}: teaching groups must cover all source positions exactly once and in order`);
  }
  if (indices.length !== pronunciation.length) needsReview(`${word}: unresolved silent or multi-phone alignment requires explicit review`);
  const groups = indices.map((positions, index) => {
    const parts = positions.map(position => segments[position]);
    const sounding = parts.filter(part => part.ipa);
    if (sounding.length !== 1) needsReview(`${word}: teaching group must contain exactly one source phoneme`);
    const phone = pronunciation[index];
    const basePhone = phone.replace(/[012]$/, '');
    if (policy.nrcIpaToPhone[sounding[0].ipa] !== basePhone) needsReview(`${word}: NRC alignment and CMU pronunciation disagree at ${index}`);
    const phoneClass = phoneClasses[basePhone];
    if (!phoneClass) throw new Error(`${word}: phone class missing for ${phone}`);
    const cueEntry = policy.phoneCues[phone] ?? policy.phoneCues[basePhone];
    if (!cueEntry || !['documented', 'unsupported'].includes(cueEntry.status)) throw new Error(`${word}: phone policy missing for ${phone}`);
    const cue = cueEntry.cue;
    if (cueEntry.status === 'unsupported' ? cue !== null : !['quick', 'stretch'].includes(cue) || !cueEntry.sourcePage) throw new Error(`${word}: invalid cue evidence for ${phone}`);
    const phoneme = phone === 'AH0' ? 'ə' : phone === 'ER0' ? 'ɚ' : policy.ipaByPhone[basePhone];
    if (!phoneme) throw new Error(`${word}: phone notation missing for ${phone}`);
    const vowel = phoneClass !== 'vowel' ? null : phone === 'AH0' ? 'reduced' : policy.vowelClassByPhone[basePhone];
    if (phoneClass === 'vowel' && !vowel) throw new Error(`${word}: vowel classification missing`);
    return { text: parts.map(part => part.text).join(''), phoneme, arpabet: phone, phoneClass, cue, cueStatus: cueEntry.status, cueSourcePage: cueEntry.sourcePage, vowel };
  });
  return { groups, provenance: { pronunciation: word + ' ' + pronunciation.join(' '), alignment: segments.map(segment => ({ ...segment })), teachingAdjustment: adjustment?.reason ?? null } };
}

export function parsePronunciations(source) {
  const words = new Map();
  let alternativePronunciations = 0;
  for (const row of source.split('\n')) {
    const line = row.replace(/\s*#.*$/, '').trim();
    if (!line || line.startsWith(';;;')) continue;
    const [word, ...phones] = line.split(/\s+/);
    if (/\(\d+\)$/.test(word)) { alternativePronunciations++; continue; }
    if (!phones.length || phones.some(phone => !/^[A-Z]+[012]?$/.test(phone))) throw new Error(`Malformed CMU pronunciation: ${word}`);
    if (words.has(word)) throw new Error(`Duplicate primary pronunciation: ${word}`);
    words.set(word, phones);
  }
  return { words, alternativePronunciations };
}

// At most two ASCII letters, with punctuation represented by _, matches the browser lookup.
export const shardKey = word => word.toLowerCase().slice(0, 2).replace(/[^a-z]/g, '_');

export function buildDictionary() {
  const lock = json('data/sources.lock.json');
  for (const [key, file] of Object.entries(sourceFiles)) {
    if (sha256(read(file)) !== lock[key].sha256) throw new Error(`Pinned source checksum mismatch: ${file}`);
  }
  const policy = json('data/policies/sound-cues.json');
  const teaching = json('data/policies/teaching-groups.json');
  const { words: pronunciations, alternativePronunciations } = parsePronunciations(read(sourceFiles.cmudict));
  const phoneClasses = Object.fromEntries(read(sourceFiles.phoneClasses).trim().split('\n').map(line => line.trim().split(/\s+/)));
  const alignments = new Map();
  for (const line of read(sourceFiles.alignment).trim().split('\n')) {
    const segments = parseAlignment(line);
    const word = segments.map(segment => segment.text).join('');
    if (alignments.has(word)) throw new Error(`${word}: ambiguous source alignment`);
    alignments.set(word, segments);
  }
  const words = Object.create(null);
  const pronunciationOnly = Object.create(null);
  const counts = { total: pronunciations.size, complete: 0, pronunciationOnly: 0, missingAlignment: 0, unresolvedAlignment: 0, completeCueSets: 0, alternativePronunciations, sourceAlignments: alignments.size };
  for (const word of [...pronunciations.keys()].sort()) {
    const pronunciation = pronunciations.get(word);
    const segments = alignments.get(word);
    if (!segments) {
      pronunciationOnly[word] = { pronunciation, reason: 'missing-alignment' };
      counts.missingAlignment++;
      counts.pronunciationOnly++;
      continue;
    }
    const adjustment = Object.hasOwn(teaching.overrides, word) ? teaching.overrides[word] : undefined;
    try {
      words[word] = compileEntry(word, segments, pronunciation, phoneClasses, policy, adjustment);
      counts.complete++;
      if (words[word].groups.every(group => group.cue !== null)) counts.completeCueSets++;
    } catch (error) {
      // Overlays are deliberate reviewed mappings: a stale overlay must fail the build.
      if (!(error instanceof AlignmentReviewError) || adjustment) throw error;
      pronunciationOnly[word] = { pronunciation, reason: 'unresolved-alignment' };
      counts.unresolvedAlignment++;
      counts.pronunciationOnly++;
    }
  }
  for (const word of Object.keys(teaching.overrides)) {
    if (!Object.hasOwn(words, word) || !words[word].groups) throw new Error(`${word}: teaching overlay was not applied`);
  }
  return { locale: 'en-US', sources: lock, policyVersion: policy.version, cuePolicy: policy.policyId, cueSource: policy.cueSource, teachingReference: teaching.reference, counts, words, pronunciationOnly };
}

export function buildArtifacts(dictionary = buildDictionary()) {
  const shards = new Map();
  const entries = [...Object.entries(dictionary.words), ...Object.entries(dictionary.pronunciationOnly)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [word, entry] of entries) {
    const key = shardKey(word);
    if (!shards.has(key)) shards.set(key, Object.create(null));
    shards.get(key)[word] = entry.groups
      ? { groups: entry.groups.map(({ text, phoneme, cue, vowel }) => ({ text, phoneme, cue, vowel })) }
      : entry;
  }
  const files = new Map();
  const manifest = {
    schemaVersion: 1,
    locale: dictionary.locale,
    pronunciationSelection: 'CMUdict primary entry; numbered alternatives are not selected contextually.',
    coverageNote: 'Complete means validated letter-to-phone groups, not complete cue evidence. Pronunciation-only entries have no inferred letter grouping.',
    shardKey: 'Lowercase word, first two characters, replace each non a-z character with underscore.',
    counts: dictionary.counts,
    policyVersion: dictionary.policyVersion,
    cuePolicy: dictionary.cuePolicy,
    cueSource: dictionary.cueSource,
    teachingReference: dictionary.teachingReference,
    policySha256: sha256(read('data/policies/sound-cues.json')),
    teachingGroupsSha256: sha256(read('data/policies/teaching-groups.json')),
    sources: dictionary.sources,
    shards: Object.create(null),
  };
  for (const [key, words] of [...shards].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const serialized = JSON.stringify(words) + '\n';
    const path = `lexicon/shards/${key}.json`;
    const entries = Object.values(words);
    const complete = entries.filter(entry => entry.groups).length;
    manifest.shards[key] = { path, sha256: sha256(serialized), bytes: Buffer.byteLength(serialized), words: entries.length, complete, pronunciationOnly: entries.length - complete };
    files.set(`public/${path}`, serialized);
  }
  files.set('public/lexicon/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  return { files, manifest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], 'file://' + process.cwd() + '/'))) {
  const { files, manifest } = buildArtifacts();
  const directory = new URL('public/lexicon/shards/', root);
  if (process.argv.includes('--check')) {
    for (const [path, serialized] of files) {
      if (read(path) !== serialized) throw new Error(`Generated lexicon is stale: ${path}. Run npm run data:build.`);
    }
    const expected = new Set([...files.keys()].filter(path => path.includes('/shards/')).map(path => path.split('/').at(-1)));
    for (const name of readdirSync(directory)) {
      if (!expected.has(name)) throw new Error(`Unexpected generated shard: ${name}. Run npm run data:build.`);
    }
    console.log('Pinned full sources and generated lexicon shards match.');
  } else {
    mkdirSync(directory, { recursive: true });
    for (const name of readdirSync(directory)) {
      if (name.endsWith('.json')) rmSync(new URL(name, directory));
    }
    for (const [path, serialized] of files) writeFileSync(new URL(path, root), serialized);
    console.log(`Generated ${manifest.counts.complete} validated mappings and ${manifest.counts.pronunciationOnly} pronunciation-only entries in ${Object.keys(manifest.shards).length} shards.`);
  }
}
