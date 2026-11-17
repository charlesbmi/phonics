export interface SoundGroup {
  text: string;
  phoneme?: string;
  arpabet?: string;
  cue?: string | null;
  vowel: string | null;
  silent?: boolean;
}
export interface SoundEvent {
  phoneme: string;
  arpabet?: string;
  cue: string | null;
  vowel: string | null;
  groupIndices: number[];
}
export interface TeachingUnit {
  groupIndices: number[];
  letterIndices?: number[];
  phoneIndices: number[];
  patternId: string;
  phoneme: string;
  vowel: string | null;
  evidence?: string;
}
export interface WordAlignment {
  groups: SoundGroup[];
  sounds?: SoundEvent[];
  teachingUnits?: TeachingUnit[];
}
export interface PronunciationVariant {
  id: string;
  pronunciation: string[];
  phonemes: string[];
  aligned: boolean;
  entry?: WordAlignment;
}
export interface WordMetadata {
  variants?: PronunciationVariant[];
  primaryVariantId?: string;
  pronunciationAmbiguous?: boolean;
}
export interface WordEntry extends WordAlignment, WordMetadata {}
export function soundEvents(entry: WordAlignment | undefined): SoundEvent[] {
  if (!entry) return [];
  return entry.sounds ?? entry.groups.flatMap((group, index) => group.silent ? [] : [{ ...group, phoneme: group.phoneme ?? '', cue: group.cue ?? null, groupIndices: [index] }]);
}
// Completeness concerns sound events: silent spelling spans have no sound cue.
export function hasBlendingCues(entry: WordAlignment | undefined): boolean {
  const sounds = soundEvents(entry);
  return sounds.length > 0 && sounds.every(sound => sound.cue === 'quick' || sound.cue === 'stretch');
}
export function soundLetters(entry: WordAlignment, sound: SoundEvent): string {
  const index = entry.sounds?.indexOf(sound) ?? -1;
  const unit = entry.teachingUnits?.find(unit => unit.phoneIndices.includes(index));
  return unit ? unit.groupIndices.map(index => entry.groups[index].text).join(unit.patternId.startsWith('split-') ? '…' : '')
    : sound.groupIndices.map(index => entry.groups[index].text).join('');
}
export function groupSoundIndices(entry: WordAlignment, groupIndex: number): number[] {
  const indices = new Set(soundEvents(entry).flatMap((sound, index) => sound.groupIndices.includes(groupIndex) ? [index] : []));
  for (const unit of entry.teachingUnits ?? []) if (unit.groupIndices.includes(groupIndex)) unit.phoneIndices.forEach(index => indices.add(index));
  return [...indices].sort((a, b) => a - b);
}
export interface GroupBounds { left: number; right: number }
export function soundCueBounds(entry: WordAlignment, bounds: GroupBounds[]): Array<{ left: number; width: number }> {
  const sounds = soundEvents(entry);
  const visibleGroups = sounds.map((sound, index) => {
    const team = entry.teachingUnits?.find(unit => unit.phoneIndices.length === 1 && unit.phoneIndices[0] === index && !unit.patternId.startsWith('split-'));
    return team?.groupIndices ?? sound.groupIndices;
  });
  const keys = visibleGroups.map(groups => groups.join(','));
  const rects = sounds.map((_, index) => {
    const linked = visibleGroups[index].map(group => bounds[group]);
    const left = Math.min(...linked.map(group => group.left));
    const right = Math.max(...linked.map(group => group.right));
    const siblings = keys.flatMap((key, i) => key === keys[index] ? [i] : []);
    const width = (right - left) / siblings.length;
    return { left: left + siblings.indexOf(index) * width, width };
  });
  // Linked spelling ranges can overlap; give each ordered sound its own hit cell.
  for (let start = 0; start < rects.length; start++) {
    let end = start;
    let left = rects[start].left;
    let right = left + rects[start].width;
    while (end + 1 < rects.length && rects[end + 1].left < right - .01) {
      end++;
      left = Math.min(left, rects[end].left);
      right = Math.max(right, rects[end].left + rects[end].width);
    }
    if (end > start) {
      const width = (right - left) / (end - start + 1);
      for (let index = start; index <= end; index++) rects[index] = { left: left + (index - start) * width, width };
    }
    start = end;
  }
  return rects;
}
export type HintOverride = 'default' | 'show' | 'hide';
export interface Token { text: string; word: boolean; occurrence: number }

// Preserve the original whitespace, punctuation, casing and repeated occurrences.
export function tokenize(text: string): Token[] {
  let occurrence = 0;
  return (text.match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu) ?? []).map((part) => {
    const word = /^[\p{L}\p{M}]/u.test(part);
    return { text: part, word, occurrence: word ? occurrence++ : -1 };
  });
}
export function hintsVisible(defaultVisible: boolean, override: HintOverride): boolean {
  return override === 'show' || (override === 'default' && defaultVisible);
}
export function soundAtClientX(clientX: number, rightEdges: number[]): number {
  const index = rightEdges.findIndex(right => clientX < right);
  return index < 0 ? rightEdges.length - 1 : index;
}
