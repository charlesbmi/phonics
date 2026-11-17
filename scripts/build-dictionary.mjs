import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const json = path => JSON.parse(read(path));
export const sha256 = text => createHash('sha256').update(text).digest('hex');
const sourceFiles = { cmudict: 'data/upstream/cmudict.dict', alignment: 'data/upstream/nrc-aligned.txt', phoneClasses: 'data/upstream/cmudict.phones', ipaConversion: 'data/upstream/nrc-ipa-graphs.json' };
const conversion = json(sourceFiles.ipaConversion);
class AlignmentReviewError extends Error { constructor(message, reason = 'unresolved-alignment') { super(message); this.reason = reason; } }
const needsReview = (message, reason) => { throw new AlignmentReviewError(message, reason); };
const basePhone = phone => phone.replace(/[012]$/, '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function parseAlignment(line) {
  return line.trim().split(/\s+/).map(pair => {
    const parts = pair.split('}');
    if (parts.length !== 2) throw new Error(`Malformed alignment: ${pair}`);
    return { text: parts[0].replaceAll('|', '').replaceAll('_', ''), ipa: parts[1].replaceAll('|', '').replaceAll('_', ''), raw: pair };
  });
}

export function phoneNotation(phone, policy) {
  const phoneme = phone === 'AH0' ? 'ə' : phone === 'ER0' ? 'ɚ' : policy.ipaByPhone[basePhone(phone)];
  if (!phoneme) throw new Error(`Phone notation missing for ${phone}`);
  return phoneme;
}

function compileSound(phone, groupIndices, phoneClasses, policy) {
  const base = basePhone(phone);
  const phoneClass = phoneClasses[base];
  if (!phoneClass) throw new Error(`Phone class missing for ${phone}`);
  const evidence = policy.phoneCues[phone] ?? policy.phoneCues[base];
  if (!evidence || !['documented', 'unsupported'].includes(evidence.status)) throw new Error(`Phone policy missing for ${phone}`);
  if (evidence.status === 'unsupported' ? evidence.cue !== null : !['quick', 'stretch'].includes(evidence.cue) || !(evidence.sourcePage || (evidence.cueSource && evidence.sourceLocation))) throw new Error(`Invalid cue evidence for ${phone}`);
  const vowel = phoneClass !== 'vowel' ? null : phone === 'AH0' ? 'reduced' : policy.vowelClassByPhone[base];
  if (phoneClass === 'vowel' && !vowel) throw new Error(`Vowel classification missing for ${phone}`);
  return { phoneme: phoneNotation(phone, policy), arpabet: phone, phoneClass, cue: evidence.cue, cueStatus: evidence.status,
    cueSourcePage: evidence.sourcePage ?? null, cueSource: evidence.cueSource ?? null,
    cueSourceLocation: evidence.sourceLocation ?? null, vowel, groupIndices };
}

export function deriveTeachingUnits(groups, sounds, teaching) {
  if (!teaching) return [];
  if (teaching.overrides && Object.keys(teaching.overrides).length) throw new Error('Word-specific teaching overrides are not supported');
  let offset = 0;
  const starts = groups.map(group => { const start = offset; offset += group.text.length; return start; });
  const phonesFor = indices => sounds.flatMap((sound, index) => sound.groupIndices.some(group => indices.includes(group)) ? [index] : []);
  const units = [];
  for (const pattern of teaching.patterns) {
    for (let start = 0; start < groups.length; start++) {
      let indices;
      if (pattern.kind === 'split-digraph') {
        if (start + 3 !== groups.length) continue;
        const [vowel, consonant, final] = groups.slice(start);
        if (vowel.text !== pattern.spelling[0] || !/^[bcdfghjklmnpqrstvwxyz]$/.test(consonant.text) || final.text !== 'e' || !final.silent) continue;
        indices = [start, start + 2];
      } else {
        let text = '';
        indices = [];
        for (let end = start; end < groups.length && text.length < pattern.spelling.length; end++) { text += groups[end].text; indices.push(end); }
        const sharedPhone = sounds.some(sound => sound.groupIndices.length > 1 && sound.groupIndices.every(index => indices.includes(index)));
        if (text !== pattern.spelling || indices.length < 2 || !(indices.some(index => groups[index].silent) || sharedPhone)) continue;
      }
      const phoneIndices = phonesFor(indices);
      if (phoneIndices.some(index => sounds[index].groupIndices.some(group => !indices.includes(group)))) continue;
      const actual = phoneIndices.map(index => basePhone(sounds[index].arpabet));
      if (!pattern.phones.some(phones => same(phones, actual))) continue;
      units.push({ groupIndices: indices, letterIndices: indices.flatMap(index => Array.from({ length: groups[index].text.length }, (_, position) => starts[index] + position)),
        phoneIndices, patternId: pattern.id, phoneme: phoneIndices.map(index => sounds[index].phoneme).join(''), vowel: pattern.vowel ?? null, evidence: teaching.reference });
    }
  }
  // Source-empty letters can fit incompatible pattern candidates. Withhold all
  // conflicting candidates rather than choose which sound owns the letter.
  const conflicts = new Set();
  for (let left = 0; left < units.length; left++) for (let right = left + 1; right < units.length; right++) {
    if (units[left].groupIndices.some(index => units[right].groupIndices.includes(index)) && !same(units[left].phoneIndices, units[right].phoneIndices)) {
      conflicts.add(left); conflicts.add(right);
    }
  }
  return units.filter((_, index) => !conflicts.has(index));
}

export function compileEntry(word, segments, pronunciation, phoneClasses, policy, teaching) {
  if (segments.map(segment => segment.text).join('') !== word) throw new Error(`${word}: alignment spelling differs`);
  const ipa = segments.map(segment => segment.ipa).join('');
  const converted = conversion.pronunciations[ipa];
  if (!converted) needsReview(word + ': unresolved whole-pronunciation library IPA graph');
  if (segments.some(segment => !segment.text)) needsReview(word + ': source insertion has no spelling span');
  if (!same(converted.map(([phone]) => phone), pronunciation.map(basePhone))) needsReview(word + ': NRC alignment and CMU pronunciation disagree');
  const ipaOwners = segments.flatMap((segment, index) => Array.from(segment.ipa, () => index));
  const sounds = converted.map(([, inputIndices], index) => {
    if (!inputIndices.length || inputIndices.some(input => !Number.isInteger(input) || input < 0 || input >= ipaOwners.length)) throw new Error(word + ': invalid pinned library graph input index');
    const groupIndices = [...new Set(inputIndices.map(input => ipaOwners[input]))].sort((a, b) => a - b);
    return compileSound(pronunciation[index], groupIndices, phoneClasses, policy);
  });
  const groups = segments.map((segment, index) => {
    const events = sounds.filter(sound => sound.groupIndices.includes(index));
    if (!segment.ipa && events.length) throw new Error(word + ': source epsilon acquired a sound event');
    if (segment.ipa && !events.length) needsReview(word + ': library graph lost a source IPA span');
    const single = events.length === 1 ? events[0] : null;
    return { text: segment.text, phoneme: events.map(event => event.phoneme).join(''), arpabet: events.map(event => event.arpabet).join(' '),
      phoneClass: single?.phoneClass ?? null, cue: single?.cue ?? null, cueStatus: single?.cueStatus ?? (events.length ? 'compound' : 'silent'),
      cueSourcePage: single?.cueSourcePage ?? null, cueSource: single?.cueSource ?? null, cueSourceLocation: single?.cueSourceLocation ?? null,
      vowel: single?.vowel ?? null, ...(!segment.ipa ? { silent: true } : {}) };
  });
  const teachingUnits = deriveTeachingUnits(groups, sounds, teaching);
  // Sequence agreement does not validate pedagogically misleading letter ownership.
  // Keep such words pronunciation-only rather than move a vowel onto guessed letters.
  for (const sound of sounds) {
    if (sound.phoneClass !== 'vowel') continue;
    const hasVowelLetter = indices => indices.some(index => /[aeiouy]/.test(groups[index].text));
    if (!hasVowelLetter(sound.groupIndices) && !teachingUnits.some(unit => unit.groupIndices.some(index => sound.groupIndices.includes(index)) && hasVowelLetter(unit.groupIndices))) {
      needsReview(word + ': source vowel is linked only to consonant letters without a supported teaching unit', 'alignment-review');
    }
  }
  // A bare vowel-letter span feeding only stop/fricative/etc. events is also
  // misleading without a sourced unit; glides Y/W remain legitimate sounds.
  for (const [groupIndex, group] of groups.entries()) {
    if (!/^[aeiouy]+$/.test(group.text) || group.silent) continue;
    const phoneIndices = sounds.flatMap((sound, index) => sound.groupIndices.includes(groupIndex) ? [index] : []);
    if (phoneIndices.some(index => sounds[index].phoneClass === 'vowel') || phoneIndices.every(index => ['Y', 'W'].includes(basePhone(sounds[index].arpabet)))) continue;
    if (!teachingUnits.some(unit => unit.groupIndices.includes(groupIndex) && phoneIndices.every(index => unit.phoneIndices.includes(index)))) {
      needsReview(word + ': source vowel letters feed only consonant sounds without a supported teaching unit', 'alignment-review');
    }
  }
  return { groups, sounds, ...(teachingUnits.length ? { teachingUnits } : {}),
    provenance: { pronunciation: word + ' ' + pronunciation.join(' '), alignment: segments.map(segment => ({ ...segment })),
      conversion: 'NRC g2p eng-ipa → eng-arpabet; pinned library-generated whole-pronunciation token graphs', teachingAdjustment: null } };
}

export function parsePronunciations(source) {
  const words = new Map();
  const variants = new Map();
  let alternativePronunciations = 0;
  for (const row of source.split('\n')) {
    const line = row.replace(/\s*#.*$/, '').trim();
    if (!line || line.startsWith(';;;')) continue;
    const [id, ...phones] = line.split(/\s+/);
    if (!phones.length || phones.some(phone => !/^[A-Z]+[012]?$/.test(phone))) throw new Error(`Malformed CMU pronunciation: ${id}`);
    const word = id.replace(/\(\d+\)$/, '');
    if (!variants.has(word)) variants.set(word, []);
    if (variants.get(word).some(variant => variant.id === id)) throw new Error(`Duplicate ${word === id ? 'primary pronunciation' : 'variant'}: ${id}`);
    variants.get(word).push({ id, pronunciation: phones });
    if (word !== id) { alternativePronunciations++; continue; }
    words.set(word, phones);
  }
  for (const word of variants.keys()) if (!words.has(word)) throw new Error(`Missing primary pronunciation: ${word}`);
  return { words, variants, alternativePronunciations };
}

export const shardKey = word => word.toLowerCase().slice(0, 2).replace(/[^a-z]/g, '_');

export function buildDictionary() {
  const lock = json('data/sources.lock.json');
  for (const [key, file] of Object.entries(sourceFiles)) if (sha256(read(file)) !== lock[key].sha256) throw new Error(`Pinned source checksum mismatch: ${file}`);
  if (conversion.sourceAlignmentSha256 !== lock.alignment.sha256 || conversion.library.revision !== lock.alignment.revision) throw new Error('NRC conversion and alignment revisions differ');
  const policy = json('data/policies/sound-cues.json');
  const teaching = json('data/policies/teaching-groups.json');
  const { words: pronunciations, variants, alternativePronunciations } = parsePronunciations(read(sourceFiles.cmudict));
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
  const counts = { total: pronunciations.size, complete: 0, pronunciationOnly: 0, missingAlignment: 0, unresolvedAlignment: 0, completeCueSets: 0, alternativePronunciations, sourceAlignments: alignments.size,
    withSilentGroups: 0, withMultiPhoneGroups: 0, withTeachingUnits: 0, ambiguousPronunciations: 0, alignedAlternatives: 0, alignmentReview: 0, withSharedPhoneGroups: 0, sourceSequenceAgreement: 0, unspannedSourceInsertions: 0, pronunciationDisagreement: 0 };
  for (const word of [...pronunciations.keys()].sort()) {
    const pronunciation = pronunciations.get(word);
    const segments = alignments.get(word);
    let entry;
    let reason;
    if (!segments) { reason = 'missing-alignment'; counts.missingAlignment++; }
    else {
      const graph = conversion.pronunciations[segments.map(segment => segment.ipa).join('')];
      const agrees = graph && same(graph.map(([phone]) => phone), pronunciation.map(basePhone));
      if (agrees) { counts.sourceSequenceAgreement++; if (segments.some(segment => !segment.text)) counts.unspannedSourceInsertions++; }
      else counts.pronunciationDisagreement++;
      try { entry = compileEntry(word, segments, pronunciation, phoneClasses, policy, teaching); }
      catch (error) { if (!(error instanceof AlignmentReviewError)) throw error; reason = error.reason; if (reason === 'alignment-review') counts.alignmentReview++; else counts.unresolvedAlignment++; }
    }
    const pronunciationAmbiguous = new Set(variants.get(word).map(variant => variant.pronunciation.join(' '))).size > 1;
    if (pronunciationAmbiguous) counts.ambiguousPronunciations++;
    const preservedVariants = variants.get(word).map(variant => {
      let aligned = variant.id === word && !!entry;
      let alternative;
      if (variant.id !== word && segments) {
        try { alternative = compileEntry(word, segments, variant.pronunciation, phoneClasses, policy, teaching); aligned = true; counts.alignedAlternatives++; }
        catch (error) { if (!(error instanceof AlignmentReviewError)) throw error; }
      }
      return { ...variant, phonemes: variant.pronunciation.map(phone => phoneNotation(phone, policy)), aligned,
        ...(alternative ? { entry: { groups: alternative.groups, sounds: alternative.sounds, ...(alternative.teachingUnits ? { teachingUnits: alternative.teachingUnits } : {}) } } : {}) };
    });
    const variantMetadata = { primaryVariantId: word, variants: preservedVariants, pronunciationAmbiguous };
    if (!entry) { pronunciationOnly[word] = { pronunciation, reason, ...variantMetadata }; counts.pronunciationOnly++; continue; }
    words[word] = { ...entry, ...variantMetadata };
    counts.complete++;
    if (entry.sounds.every(sound => sound.cue !== null)) counts.completeCueSets++;
    if (entry.groups.some(group => group.silent)) counts.withSilentGroups++;
    if (entry.groups.some((_, index) => entry.sounds.filter(sound => sound.groupIndices.includes(index)).length > 1)) counts.withMultiPhoneGroups++;
    if (entry.sounds.some(sound => sound.groupIndices.length > 1)) counts.withSharedPhoneGroups++;
    if (entry.teachingUnits) counts.withTeachingUnits++;
  }
  return { locale: 'en-US', sources: lock, policyVersion: policy.version, cuePolicy: policy.policyId, cueSource: policy.cueSource, teachingReference: teaching.reference, counts, words, pronunciationOnly };
}

export function buildArtifacts(dictionary = buildDictionary()) {
  const shards = new Map();
  const entries = [...Object.entries(dictionary.words), ...Object.entries(dictionary.pronunciationOnly)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const compactGroup = ({ text, vowel, silent }) => ({ text, vowel, ...(silent ? { silent } : {}) });
  const compactSound = ({ phoneme, cue, vowel, groupIndices }) => ({ phoneme, cue, vowel, groupIndices });
  const compactUnit = ({ groupIndices, phoneIndices, patternId, phoneme, vowel }) => ({ groupIndices, phoneIndices, patternId, phoneme, vowel });
  const compact = entry => ({ groups: entry.groups.map(compactGroup), sounds: entry.sounds.map(compactSound), ...(entry.teachingUnits ? { teachingUnits: entry.teachingUnits.map(compactUnit) } : {}) });
  const variantMetadata = entry => entry.variants.length > 1 ? {
    primaryVariantId: entry.primaryVariantId,
    variants: entry.variants.map(variant => ({ ...variant, ...(variant.entry ? { entry: compact(variant.entry) } : {}) })),
    pronunciationAmbiguous: entry.pronunciationAmbiguous,
  } : {};
  for (const [word, entry] of entries) {
    const key = shardKey(word);
    if (!shards.has(key)) shards.set(key, Object.create(null));
    shards.get(key)[word] = entry.groups
      ? { ...compact(entry), ...variantMetadata(entry) }
      : { pronunciation: entry.pronunciation, reason: entry.reason, ...variantMetadata(entry) };
  }
  const files = new Map();
  const manifest = {
    schemaVersion: 2, locale: dictionary.locale,
    pronunciationSelection: 'CMUdict primary entry is the default display. All numbered source variants are retained; differing pronunciations require explicit selection and unaligned variants withhold letter hints. No contextual selection.',
    alignmentReviewPolicy: 'Vowel events linked only to consonant spelling spans are withheld unless a separately sourced teaching unit includes vowel letters. Vowel-only spelling spans linked only to consonant events also require a sourced unit, except genuine Y/W glides. These conservative gates do not certify the remaining source links as pedagogically validated.',
    coverageNote: 'Complete means exact primary CMU phone agreement with NRC source spans through the pinned NRC IPA converter, not pedagogical validation or complete cue evidence. Silent source spans have no sound event; multi-phone spans have separate events, and shared phones link multiple original spelling spans. General teaching patterns are separate policy units.',
    shardKey: 'Lowercase word, first two characters, replace each non a-z character with underscore.',
    counts: dictionary.counts, policyVersion: dictionary.policyVersion, cuePolicy: dictionary.cuePolicy, cueSource: dictionary.cueSource, teachingReference: dictionary.teachingReference,
    policySha256: sha256(read('data/policies/sound-cues.json')), teachingGroupsSha256: sha256(read('data/policies/teaching-groups.json')), sources: dictionary.sources, shards: Object.create(null),
  };
  for (const [key, words] of [...shards].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const serialized = JSON.stringify(words) + '\n';
    const path = `lexicon/shards/${key}.json`;
    const values = Object.values(words);
    const complete = values.filter(entry => entry.groups).length;
    manifest.shards[key] = { path, sha256: sha256(serialized), bytes: Buffer.byteLength(serialized), words: values.length, complete, pronunciationOnly: values.length - complete };
    files.set(`public/${path}`, serialized);
  }
  files.set('public/lexicon/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  return { files, manifest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], 'file://' + process.cwd() + '/'))) {
  const { files, manifest } = buildArtifacts();
  const directory = new URL('public/lexicon/shards/', root);
  if (process.argv.includes('--check')) {
    for (const [path, serialized] of files) if (read(path) !== serialized) throw new Error(`Generated lexicon is stale: ${path}. Run npm run data:build.`);
    const expected = new Set([...files.keys()].filter(path => path.includes('/shards/')).map(path => path.split('/').at(-1)));
    for (const name of readdirSync(directory)) if (!expected.has(name)) throw new Error(`Unexpected generated shard: ${name}. Run npm run data:build.`);
    console.log('Pinned full sources and generated lexicon shards match.');
  } else {
    mkdirSync(directory, { recursive: true });
    for (const name of readdirSync(directory)) if (name.endsWith('.json')) rmSync(new URL(name, directory));
    for (const [path, serialized] of files) writeFileSync(new URL(path, root), serialized);
    console.log(`Generated ${manifest.counts.complete} validated mappings and ${manifest.counts.pronunciationOnly} pronunciation-only entries in ${Object.keys(manifest.shards).length} shards.`);
  }
}
