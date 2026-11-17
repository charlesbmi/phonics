import { normalizeWord } from './lexicon';
import type { LexiconEntry } from './lexicon';
import type { WordEntry } from './model';

interface ReviewWord {
  word: string;
  rank: number;
  reason: string;
  reasonCode: 'missing-alignment' | 'unresolved-alignment' | 'alignment-review';
  pronunciation: string[];
  phonemes: string[];
  sourceSegments: Array<{ text: string; ipa: string; raw: string }>;
  sourcePhones: string[] | null;
  candidate: WordEntry | null;
}
interface ReviewData { schemaVersion: number; id: string; words: ReviewWord[] }
interface Feedback { verdict: 'looks-right' | 'needs-changes' | null; note: string }
export interface AlignmentReview {
  readonly currentWord: string;
  lookup(word: string): LexiconEntry | undefined;
}

export async function installAlignmentReview(container: HTMLElement, onChooseWord: (word: string) => void): Promise<AlignmentReview> {
  const response = await fetch(new URL('review/alignments.json', new URL(import.meta.env.BASE_URL, location.href)), { cache: 'no-cache' });
  if (!response.ok) throw Error('The alignment review could not be loaded. Reload to try again.');
  const data: ReviewData = await response.json();
  if (data.schemaVersion !== 1 || !data.id || !Array.isArray(data.words) || !data.words.length) throw Error('Unsupported alignment review data.');
  const storageKey = `little-reader-alignment-review:${data.id}`;
  let feedback: Record<string, Feedback> = Object.create(null);
  let storageAvailable = true;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    for (const { word } of data.words) {
      const item = saved?.[word];
      if (item && [null, 'looks-right', 'needs-changes'].includes(item.verdict) && typeof item.note === 'string') feedback[word] = item;
    }
  } catch { storageAvailable = false; }
  let index = Math.max(0, data.words.findIndex(row => row.candidate));
  try { const last = localStorage.getItem(`${storageKey}:word`); const found = data.words.findIndex(row => row.word === last); if (found >= 0) index = found; } catch { /* Position persistence is optional. */ }
  let showCandidate = true;
  container.classList.add('alignment-review');
  container.innerHTML = `
    <div class="review-toolbar"><h2>Review unmarked words</h2><span class="badge">Review</span></div>
    <p class="muted">Preview withheld hints. Feedback stays local; the dictionary is unchanged.</p>
    <div class="review-toolbar review-navigation"><button type="button" data-review="previous" aria-label="Previous word">←</button><label class="sr-only" for="review-word">Choose a word</label><select id="review-word" aria-label="Choose a word"></select><button type="button" data-review="next" aria-label="Next word">→</button></div>
    <p class="muted" data-review="progress" aria-live="polite"></p>
    <div class="review-toolbar" role="group" aria-label="Alignment preview"><button type="button" data-review="current" aria-label="Current app hints">Current</button><button type="button" data-review="candidate" aria-label="Unapproved source preview">Candidate</button></div>
    <p data-review="mode" role="status"></p>
    <p data-review="reason"></p>
    <details class="review-source"><summary>Compare source letters and sounds</summary><p class="muted">Original NRC letter → IPA spans. ∅ means the source has no letters or no sound in that span.</p><div class="review-source-cards" data-review="source"></div><p data-review="cmu"></p><p data-review="phones"></p></details>
    <div class="review-feedback"><h3>Your feedback</h3><p class="muted">Feedback stays in this browser. Download it to share later.</p><div class="review-toolbar" role="group" aria-label="Your verdict"><button type="button" data-review="right">Looks right</button><button type="button" data-review="changes">Needs changes</button><button type="button" data-review="clear">Clear verdict</button></div><label for="review-note">What should change? (optional)</label><textarea id="review-note" rows="2" placeholder="For example: this sound should cover both letters."></textarea><p class="muted" data-review="saved" role="status"></p><button type="button" data-review="download">Download feedback</button></div>`;
  const get = <T extends HTMLElement>(name: string) => container.querySelector<T>(`[data-review="${name}"]`)!;
  const previous = get<HTMLButtonElement>('previous');
  const next = get<HTMLButtonElement>('next');
  const current = get<HTMLButtonElement>('current');
  const candidate = get<HTMLButtonElement>('candidate');
  const choose = container.querySelector<HTMLSelectElement>('#review-word')!;
  const note = container.querySelector<HTMLTextAreaElement>('#review-note')!;
  const right = get<HTMLButtonElement>('right');
  const changes = get<HTMLButtonElement>('changes');
  const options = data.words.map((row, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    choose.append(option);
    return { option, row };
  });
  const state = () => feedback[data.words[index].word] ?? { verdict: null, note: '' };

  function updateFeedback(): void {
    const item = state();
    right.setAttribute('aria-pressed', String(item.verdict === 'looks-right'));
    changes.setAttribute('aria-pressed', String(item.verdict === 'needs-changes'));
    get<HTMLButtonElement>('clear').disabled = item.verdict === null;
    const reviewed = data.words.filter(row => feedback[row.word]?.verdict).length;
    get('progress').textContent = `Word ${index + 1} of ${data.words.length} · ${reviewed} with feedback`;
    options.forEach(({ option, row }, i) => {
      const verdict = feedback[row.word]?.verdict;
      option.textContent = `${i + 1}. ${row.word}${verdict === 'looks-right' ? ' · looks right' : verdict === 'needs-changes' ? ' · needs changes' : ''}`;
    });
    get('saved').textContent = storageAvailable ? 'Saved on this browser only. The dictionary is unchanged.' : 'Browser storage is unavailable. Download feedback before leaving.';
  }
  function save(item: Feedback): void {
    feedback[data.words[index].word] = item;
    try { localStorage.setItem(storageKey, JSON.stringify(feedback)); } catch { storageAvailable = false; }
    updateFeedback();
  }
  function update(notify = true): void {
    const row = data.words[index];
    try { localStorage.setItem(`${storageKey}:word`, row.word); } catch { /* Feedback download remains available. */ }
    choose.value = String(index);
    previous.disabled = index === 0;
    next.disabled = index === data.words.length - 1;
    current.setAttribute('aria-pressed', String(!showCandidate));
    candidate.setAttribute('aria-pressed', String(showCandidate));
    get('mode').textContent = !showCandidate ? 'CURRENT APP · This word stays unmarked.' : row.candidate ? 'UNAPPROVED PREVIEW · Original source links, shown with the reader’s actual hints.' : 'NO SAFE PREVIEW · This word stays unmarked. Compare the source below.';
    get('mode').className = showCandidate ? 'review-preview-status' : '';
    get('reason').textContent = row.reasonCode === 'alignment-review' ? 'Some sound-to-letter links need review.' : 'Some sounds have no matching letter span.';
    const cards = get('source');
    cards.replaceChildren();
    for (const span of row.sourceSegments) {
      const card = document.createElement('span');
      card.className = 'review-source-card';
      card.textContent = `${span.text || '∅'} → ${span.ipa || '∅'}`;
      card.title = `Original source: ${span.raw}`;
      cards.append(card);
    }
    if (!row.sourceSegments.length) cards.textContent = 'No source alignment.';
    get('cmu').textContent = `CMU pronunciation: /${row.phonemes.join(' ')} / · ${row.pronunciation.join(' ')}`;
    get('phones').textContent = `NRC converted sounds: ${row.sourcePhones?.join(' ') ?? 'No pinned conversion available'}`;
    note.value = state().note;
    updateFeedback();
    if (notify) onChooseWord(row.word);
  }
  previous.addEventListener('click', () => { if (index > 0) { index--; update(); } });
  next.addEventListener('click', () => { if (index < data.words.length - 1) { index++; update(); } });
  choose.addEventListener('change', () => { index = Number(choose.value); update(); });
  current.addEventListener('click', () => { showCandidate = false; update(); });
  candidate.addEventListener('click', () => { showCandidate = true; update(); });
  right.addEventListener('click', () => save({ ...state(), verdict: 'looks-right' }));
  changes.addEventListener('click', () => save({ ...state(), verdict: 'needs-changes' }));
  get('clear').addEventListener('click', () => save({ ...state(), verdict: null }));
  note.addEventListener('input', () => save({ ...state(), note: note.value }));
  get('download').addEventListener('click', () => {
    const payload = { schemaVersion: 1, reviewDataId: data.id, purpose: 'Local visual feedback only; does not approve or publish alignments.', feedback: data.words.filter(row => feedback[row.word]?.verdict || feedback[row.word]?.note).map(row => ({ word: row.word, ...feedback[row.word] })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'alignment-review-feedback.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  update(false);
  return {
    get currentWord() { return data.words[index].word; },
    lookup(word) {
      const row = data.words[index];
      if (normalizeWord(word) !== row.word) return undefined;
      return showCandidate && row.candidate ? row.candidate : { pronunciation: row.pronunciation, reason: row.reasonCode };
    },
  };
}
