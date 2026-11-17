import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const json = path => JSON.parse(read(path));
export const sha256 = text => createHash('sha256').update(text).digest('hex');

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
  if (indices.length !== pronunciation.length) throw new Error(`${word}: unresolved silent or multi-phone alignment requires explicit review`);
  const groups = indices.map((positions, index) => {
    const parts = positions.map(position => segments[position]);
    const sounding = parts.filter(part => part.ipa);
    if (sounding.length !== 1) throw new Error(`${word}: teaching group must contain exactly one source phoneme`);
    const phone = pronunciation[index];
    const basePhone = phone.replace(/[012]$/, '');
    if (policy.nrcIpaToPhone[sounding[0].ipa] !== basePhone) throw new Error(`${word}: NRC alignment and CMU pronunciation disagree at ${index}`);
    const phoneClass = phoneClasses[basePhone];
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

export function buildDictionary() {
  const lock = json('data/sources.lock.json');
  const files = { cmudict: 'data/upstream/cmudict.dict', alignment: 'data/upstream/nrc-aligned.txt', phoneClasses: 'data/upstream/cmudict.phones' };
  for (const [key, file] of Object.entries(files)) {
    if (sha256(read(file)) !== lock[key].subsetSha256) throw new Error(`Pinned source checksum mismatch: ${file}`);
  }
  const policy = json('data/policies/sound-cues.json');
  const teaching = json('data/policies/teaching-groups.json');
  const wanted = json('data/words.json');
  const pronunciations = Object.fromEntries(read(files.cmudict).trim().split('\n').map(line => {
    const [word, ...phones] = line.trim().split(/\s+/); return [word, phones];
  }));
  const phoneClasses = Object.fromEntries(read(files.phoneClasses).trim().split('\n').map(line => line.trim().split(/\s+/)));
  const alignments = new Map();
  for (const line of read(files.alignment).trim().split('\n')) {
    const segments = parseAlignment(line);
    const word = segments.map(segment => segment.text).join('');
    if (alignments.has(word)) throw new Error(`${word}: ambiguous source alignment`);
    alignments.set(word, segments);
  }
  const words = {};
  for (const word of wanted) {
    if (!pronunciations[word] || !alignments.has(word)) throw new Error(`${word}: missing pinned source`);
    words[word] = compileEntry(word, alignments.get(word), pronunciations[word], phoneClasses, policy, teaching.overrides[word]);
  }
  return { locale: 'en-US', sources: lock, policyVersion: policy.version, cuePolicy: policy.policyId, cueSource: policy.cueSource, teachingReference: teaching.reference, words };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], 'file://' + process.cwd() + '/'))) {
  const serialized = JSON.stringify(buildDictionary(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (read('shared/dictionary.json') !== serialized) throw new Error('Generated dictionary is stale. Run npm run data:build.');
    console.log('Pinned sources and generated dictionary match.');
  } else {
    writeFileSync(new URL('shared/dictionary.json', root), serialized);
    console.log('Generated dictionary from pinned NRC alignments, CMU pronunciations, and explicit teaching policies.');
  }
}
