export interface SoundGroup {
  text: string;
  phoneme: string;
  cue: string | null;
  vowel: string | null;
}
export interface WordEntry { groups: SoundGroup[] }
// Completeness only: phonetic classifications are prepared from source data.
export function hasBlendingCues(entry: WordEntry | undefined): boolean {
  return !!entry?.groups.length && entry.groups.every(group => group.cue === 'quick' || group.cue === 'stretch');
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
