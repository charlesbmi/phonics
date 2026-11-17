import { Lexicon, hasLetterGroups, normalizeWord } from './lexicon';
import type { LexiconEntry } from './lexicon';
import '../shared/reader.css';
import './style.css';
import { hasBlendingCues, hintsVisible, soundAtClientX, tokenize } from './model';
import type { HintOverride, WordEntry } from './model';

const lexicon = new Lexicon(new URL(import.meta.env.BASE_URL, location.href));
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main class="app-shell">
    <header class="app-header">
      <h1>Little Reader</h1>
      <span class="badge">US English</span>
    </header>
    <section class="panel stack" aria-labelledby="text-heading">
      <h2 id="text-heading">Text to read</h2>
      <label class="sr-only" for="reading-text">Text to read</label>
      <textarea id="reading-text" spellcheck="false" rows="2">Dad. She can see a sheep. Hello!</textarea>
      <div class="sample-row" aria-label="Sample text">
        <button data-sample="Dad">Dad</button><button data-sample="She">She</button><button data-sample="hello">hello</button><button data-sample="Dad. She can see a sheep. Hello!">Sentence</button>
      </div>
      <p id="lookup-status" class="muted" role="status" hidden></p>
      <button id="lookup-retry" hidden>Retry hints</button>
      <details id="coverage" class="coverage" hidden><summary id="coverage-summary"></summary><p id="coverage-words" class="muted"></p></details>
    </section>
    <section aria-labelledby="reading-heading">
      <h2 id="reading-heading" class="sr-only">Reading space</h2>
      <div id="reader" class="reader" aria-label="Reading space"></div>
      <div id="hint-legend" class="legend" aria-label="Visible hint key" hidden>
        <span data-legend="quick" hidden><i class="legend-quick" aria-hidden="true"></i>Quick sound</span>
        <span data-legend="stretch" hidden><i class="legend-stretch" aria-hidden="true"></i>Stretch sound</span>
        <span data-legend="unclassified" hidden><i class="legend-unclassified" aria-hidden="true">?</i>Unclassified sound</span>
        <span data-legend="group" hidden><i class="legend-group" aria-hidden="true"></i>Letter group</span>
        <span data-legend="long" hidden><i class="legend-long" aria-hidden="true"></i>Long vowel</span>
        <span data-legend="vowel" hidden><i class="legend-vowel" aria-hidden="true">a</i>Vowel</span>
        <span data-legend="consonant" hidden><i class="legend-consonant" aria-hidden="true">b</i>Consonant</span>
      </div>
    </section>
    <section id="selected-panel" class="panel" aria-labelledby="selected-heading" hidden>
      <div class="toolbar"><h2 id="selected-heading"></h2><button id="speak" class="primary" disabled>▶ Hear word</button></div>
      <div id="word-tools" class="word-tools" hidden>
        <label for="hint-override">Hints</label><select id="hint-override"><option value="default">Default</option><option value="show">Show</option><option value="hide">Hide</option></select>
        <button id="reset-progress">Show whole word</button>
      </div>
      <div id="touch-sounds" class="touch-sounds" role="group" aria-label="Silent sound steps" hidden></div>
      <div id="scrubber" class="scrubber" hidden><label for="sound-progress">Sound guide (silent)</label><input id="sound-progress" type="range" min="0" value="0" step="1"/><span id="sound-count" class="selected-sound"></span></div>
      <p id="word-status" class="status" aria-live="polite"></p>
      <p id="speech-status" class="status" role="status" aria-live="polite"></p>
    </section>
    <details class="panel parent-tools">
      <summary>Reading hints</summary>
      <div class="control-grid">
        <label><input type="checkbox" id="hints" checked>Hints by default</label>
        <label><input type="checkbox" id="rail" checked>Rail</label>
        <label><input type="checkbox" id="groups" checked>Letter groups</label>
        <label><input type="checkbox" id="macrons">Long-vowel marks</label>
        <label><input type="checkbox" id="colors">Colors</label>
      </div>
      <p class="muted tools-note">Hint changes apply to one occurrence. Unsupported words stay unmarked.</p>
    </details>
    <p class="footer">Tap a word for controls; tap again to close. <a href="./third-party-licenses.txt">Data credits</a></p>
  </main>`;

const get = <T extends HTMLElement>(selector: string) => app.querySelector<T>(selector)!;
const reader = get<HTMLDivElement>('#reader');
const textarea = get<HTMLTextAreaElement>('#reading-text');
const heading = get<HTMLHeadingElement>('#selected-heading');
const tools = get<HTMLDivElement>('#word-tools');
const override = get<HTMLSelectElement>('#hint-override');
const speak = get<HTMLButtonElement>('#speak');
const wordStatus = get<HTMLParagraphElement>('#word-status');
const speechStatus = get<HTMLParagraphElement>('#speech-status');
const scrubber = get<HTMLDivElement>('#scrubber');
const progress = get<HTMLInputElement>('#sound-progress');
const count = get<HTMLSpanElement>('#sound-count');
const reset = get<HTMLButtonElement>('#reset-progress');
const settings = {
  hints: get<HTMLInputElement>('#hints'), rail: get<HTMLInputElement>('#rail'),
  groups: get<HTMLInputElement>('#groups'), macrons: get<HTMLInputElement>('#macrons'),
  colors: get<HTMLInputElement>('#colors'),
};
interface Occurrence {
  text: string;
  entry?: WordEntry;
  lexiconEntry?: LexiconEntry;
  wrapper: HTMLSpanElement;
  button: HTMLButtonElement;
  rail?: HTMLDivElement;
  graphemes: HTMLSpanElement[];
  cues: HTMLButtonElement[];
  override: HintOverride;
  active: number | null;
}
let lookupPending = false;
let lookupFailed = false;
let lookupGeneration = 0;
let lookupTimer: ReturnType<typeof setTimeout> | undefined;
let occurrences: Occurrence[] = [];
let selected: number | null = null;
let renderedText = '';
let touchControlsFor: number | null = null;
let speechGeneration = 0;
let speechTimer: ReturnType<typeof setTimeout> | undefined;
let voice: SpeechSynthesisVoice | undefined;
let retainedUtterance: SpeechSynthesisUtterance | undefined;
const speechSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function audioAvailabilityMessage(): string {
  return !speechSupported ? 'Word audio unavailable in this browser.' : !voice ? 'No US English voice available.' : '';
}

function selectWord(index: number): void {
  stopSpeech();
  speechStatus.textContent = audioAvailabilityMessage();
  if (selected !== null) occurrences[selected].active = null;
  selected = selected === index ? null : index;
  if (selected !== null) occurrences[selected].active = null;
  updatePresentation();
}
function activate(index: number, sound: number): void {
  if (retainedUtterance) stopSpeech();
  speechStatus.textContent = audioAvailabilityMessage();
  selected = index;
  occurrences[index].active = sound;
  updatePresentation();
}
function renderText(preserveSelection = false): void {
  touchControlsFor = null;
  const priorSelection = selected;
  stopSpeech();
  speechStatus.textContent = '';
  // A trailing edit leaves earlier occurrences in place. Retain their parent
  // overrides; changed words and broader edits start with fresh state.
  const previous = textarea.value.startsWith(renderedText) || renderedText.startsWith(textarea.value) ? occurrences : [];
  renderedText = textarea.value;
  occurrences = [];
  selected = null;
  reader.replaceChildren();
  for (const token of tokenize(textarea.value)) {
    if (!token.word) {
      reader.append(document.createTextNode(token.text));
      continue;
    }
    const index = token.occurrence;
    const candidate = lexicon.lookup(token.text);
    // An incomplete entry is treated as unknown rather than guessing a mapping.
    const entry = hasLetterGroups(candidate) && candidate.groups.map(g => g.text).join('').toLowerCase() === normalizeWord(token.text) ? candidate : undefined;
    const wrapper = document.createElement('span');
    wrapper.className = entry ? 'word' : 'word word-unknown';
    wrapper.dataset.occurrence = String(index);
    const button = document.createElement('button');
    button.className = 'word-button';
    button.setAttribute('aria-label', `Select ${token.text}, word ${index + 1}`);
    button.addEventListener('click', () => selectWord(index));
    const letters = document.createElement('span');
    letters.className = 'graphemes';
    const prior = previous[index];
    const occurrence: Occurrence = { text: token.text, entry, lexiconEntry: candidate, wrapper, button, graphemes: [], cues: [], override: prior?.text === token.text ? prior.override : 'default', active: preserveSelection ? prior?.active ?? null : null };
    if (entry) {
      let offset = 0;
      entry.groups.forEach((group) => {
        const grapheme = document.createElement('span');
        grapheme.className = 'grapheme';
        grapheme.textContent = token.text.slice(offset, offset + group.text.length);
        offset += group.text.length;
        occurrence.graphemes.push(grapheme);
        letters.append(grapheme);
      });
      const rail = document.createElement('div');
      rail.className = 'sound-rail';
      rail.setAttribute('aria-label', `Sound steps for ${token.text}, word ${index + 1}`);
      entry.groups.forEach((group, soundIndex) => {
        const cue = document.createElement('button');
        cue.className = `cue cue-${group.cue ?? 'unclassified'}`;
        cue.setAttribute('aria-label', `${token.text}: letters ${group.text}, sound ${soundIndex + 1} of ${entry.groups.length}, ${group.cue ?? 'unclassified'}`);
        cue.addEventListener('click', () => activate(index, soundIndex));
        occurrence.cues.push(cue);
        rail.append(cue);
      });
      // Pointer capture keeps finger/mouse scrubbing on this rail until release.
      // https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture
      const scrub = (event: PointerEvent) => {
        activate(index, soundAtClientX(event.clientX, occurrence.cues.map(cue => cue.getBoundingClientRect().right)));
      };
      rail.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        rail.setPointerCapture(event.pointerId);
        scrub(event);
      });
      rail.addEventListener('pointermove', (event) => { if (rail.hasPointerCapture(event.pointerId)) scrub(event); });
      rail.addEventListener('pointerup', (event) => { if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId); });
      occurrence.rail = rail;
    } else {
      letters.textContent = token.text;
    }
    button.append(letters);
    wrapper.append(button);
    if (occurrence.rail) wrapper.append(occurrence.rail);
    occurrences.push(occurrence);
    reader.append(wrapper);
  }
  if (!textarea.value.trim()) {
    const empty = document.createElement('span');
    empty.className = 'empty-reader';
    empty.textContent = 'Your next story starts here…';
    reader.append(empty);
  }
  if (preserveSelection && priorSelection !== null && occurrences[priorSelection]) selected = priorSelection;
  const lookupStatus = get<HTMLElement>('#lookup-status');
  lookupStatus.hidden = !lookupPending && !lookupFailed;
  lookupStatus.textContent = lookupFailed ? 'Hints could not load. Please retry.' : lookupPending ? 'Loading hints…' : '';
  get<HTMLButtonElement>('#lookup-retry').hidden = !lookupFailed;
  const unsupported = occurrences.filter(word => !word.entry);
  get<HTMLDetailsElement>('#coverage').hidden = lookupPending || lookupFailed || unsupported.length === 0;
  get<HTMLElement>('#coverage-summary').textContent = `Hints available: ${occurrences.length - unsupported.length} of ${occurrences.length} words`;
  get<HTMLElement>('#coverage-words').textContent = `Unmarked: ${[...new Set(unsupported.map(word => word.text))].join(', ')}`;
  updatePresentation();
}
function refreshText(): void {
  clearTimeout(lookupTimer);
  const generation = ++lookupGeneration;
  const text = textarea.value;
  const words = tokenize(text).filter(token => token.word).map(token => token.text);
  lookupPending = lexicon.needsWords(words);
  lookupFailed = false;
  renderText();
  if (!lookupPending) return;
  lookupTimer = setTimeout(() => {
    void lexicon.loadWords(words).then(() => {
      if (generation !== lookupGeneration || textarea.value !== text) return;
      lookupPending = false;
      renderText(true);
    }).catch(() => {
      if (generation !== lookupGeneration || textarea.value !== text) return;
      lookupPending = false;
      lookupFailed = true;
      renderText(true);
    });
  }, 120);
}

function updatePresentation(): void {
  occurrences.forEach((word, index) => {
    const isSelected = selected === index;
    const show = hintsVisible(settings.hints.checked, word.override);
    word.wrapper.classList.toggle('word-selected', isSelected);
    word.button.setAttribute('aria-pressed', String(isSelected));
    word.button.setAttribute('aria-label', `${isSelected ? 'Deselect' : 'Select'} ${word.text}, word ${index + 1}`);
    if (word.rail) {
      word.rail.hidden = !show || !settings.rail.checked;
      word.rail.style.gridTemplateColumns = word.graphemes.map(grapheme => `${grapheme.getBoundingClientRect().width}px`).join(' ');
    }
    word.graphemes.forEach((grapheme, soundIndex) => {
      const group = word.entry!.groups[soundIndex];
      grapheme.classList.toggle('group-link', show && settings.groups.checked && group.text.length > 1);
      grapheme.classList.toggle('vowel-long', show && settings.macrons.checked && group.vowel === 'long');
      grapheme.classList.toggle('letter-vowel', show && settings.colors.checked && group.vowel !== null);
      grapheme.classList.toggle('letter-consonant', show && settings.colors.checked && group.vowel === null);
      grapheme.classList.toggle('active', show && isSelected && word.active === soundIndex);
      grapheme.classList.toggle('pending', show && isSelected && word.active !== null && soundIndex > word.active);
      word.cues[soundIndex]?.classList.toggle('active', isSelected && word.active === soundIndex);
      word.cues[soundIndex]?.setAttribute('aria-pressed', String(isSelected && word.active === soundIndex));
    });
  });
  // Describe marks actually rendered, including occurrence-specific overrides.
  // Checking only the global toggles would give the wrong key for a hidden word,
  // an unknown word, or a local Show override while default hints are off.
  const legend = get<HTMLDivElement>('#hint-legend');
  const visibleMarks: Record<string, string> = {
    quick: '.sound-rail:not([hidden]) .cue-quick',
    stretch: '.sound-rail:not([hidden]) .cue-stretch',
    unclassified: '.sound-rail:not([hidden]) .cue-unclassified',
    group: '.group-link',
    long: '.vowel-long',
    vowel: '.letter-vowel',
    consonant: '.letter-consonant',
  };
  let anyLegend = false;
  for (const [kind, selector] of Object.entries(visibleMarks)) {
    const visible = reader.querySelector(selector) !== null;
    get<HTMLSpanElement>(`[data-legend="${kind}"]`).hidden = !visible;
    anyLegend ||= visible;
  }
  legend.hidden = !anyLegend;
  const word = selected === null ? undefined : occurrences[selected];
  get<HTMLElement>('#selected-panel').hidden = !word;
  heading.textContent = word?.text ?? '';
  tools.hidden = !word;
  override.disabled = !word?.entry;
  override.value = word?.override ?? 'default';
  const show = !!word && hintsVisible(settings.hints.checked, word.override);
  const touchSounds = get<HTMLDivElement>('#touch-sounds');
  touchSounds.hidden = !word?.entry?.groups.length || !show || !settings.rail.checked;
  if (touchControlsFor !== selected) {
    touchControlsFor = selected;
    touchSounds.replaceChildren();
    const index = selected;
    if (word?.entry && index !== null) {
      word.entry.groups.forEach((group, soundIndex) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = word.graphemes[soundIndex].textContent;
        button.setAttribute('aria-label', `Letters ${group.text}, sound ${soundIndex + 1} of ${word.entry!.groups.length}, ${group.cue ?? 'unclassified'}`);
        button.addEventListener('click', () => activate(index, soundIndex));
        touchSounds.append(button);
      });
    }
  }
  touchSounds.querySelectorAll('button').forEach((button, index) => button.setAttribute('aria-pressed', String(word?.active === index)));
  scrubber.hidden = !word?.entry?.groups.length || !show || !settings.rail.checked;
  reset.disabled = !word?.entry || word.active === null;
  if (word?.entry) {
    progress.max = String(word.entry.groups.length - 1);
    progress.value = String(word.active ?? 0);
    const group = word.entry.groups[word.active ?? 0];
    progress.setAttribute('aria-valuetext', `Letters ${group.text}, sound ${(word.active ?? 0) + 1} of ${word.entry.groups.length}, ${group.cue ?? 'unclassified'}`);
    count.textContent = word.active === null ? `${word.entry.groups.length} sounds` : `Sound ${word.active + 1} of ${word.entry.groups.length}`;
  }
  if (!word) wordStatus.textContent = '';
  else if (!word.entry) {
    wordStatus.textContent = word.lexiconEntry ? 'Pronunciation found; letter hints are not available yet.'
      : lookupPending ? 'Loading hints…'
      : lookupFailed ? 'Hints could not load. Please retry.'
      : 'Word not found in this dictionary.';
  } else wordStatus.textContent = !show ? 'Hints hidden.' : !hasBlendingCues(word.entry) ? 'No quick/stretch cue yet for sounds marked ?.' : '';
  speak.disabled = !word || !voice;
}
function stopSpeech(): void {
  speechGeneration++;
  clearTimeout(speechTimer);
  if (speechSupported) window.speechSynthesis.cancel();
  retainedUtterance = undefined;
}
function refreshVoices(): void {
  // Voices can arrive asynchronously via voiceschanged.
  // https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices
  if (!speechSupported) {
    speechStatus.textContent = 'Word audio is unavailable: this browser does not support speech synthesis.';
    return;
  }
  voice = window.speechSynthesis.getVoices().find(candidate => candidate.lang.replace('_', '-').toLowerCase() === 'en-us');
  speechStatus.textContent = voice ? '' : 'No US English voice available. Check your browser’s voice settings.';
  updatePresentation();
}
speak.addEventListener('click', () => {
  const word = selected === null ? undefined : occurrences[selected];
  if (!word || !voice) return;
  stopSpeech();
  const generation = speechGeneration;
  const utterance = new SpeechSynthesisUtterance(word.text);
  retainedUtterance = utterance;
  utterance.lang = 'en-US';
  utterance.voice = voice;
  utterance.rate = 0.8;
  speechStatus.textContent = 'Starting word audio…';
  // Speak whole words only. Letter-name TTS cannot provide isolated phoneme audio.
  // https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/speak
  utterance.onstart = () => {
    if (generation !== speechGeneration) return;
    clearTimeout(speechTimer);
    speechStatus.textContent = `Playing “${word.text}”…`;
  };
  utterance.onend = () => {
    if (generation !== speechGeneration) return;
    clearTimeout(speechTimer);
    speechStatus.textContent = `Played “${word.text}”.`;
    retainedUtterance = undefined;
  };
  // https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/error_event
  utterance.onerror = (event) => {
    if (generation !== speechGeneration) return;
    clearTimeout(speechTimer);
    speechStatus.textContent = `Word audio failed (${event.error}). Tap Hear word to retry.`;
    retainedUtterance = undefined;
  };
  speechTimer = setTimeout(() => {
    if (generation !== speechGeneration) return;
    stopSpeech();
    speechStatus.textContent = 'Word audio did not start. Check your browser’s voice settings and retry.';
  }, 8000);
  try { window.speechSynthesis.speak(retainedUtterance); }
  catch { stopSpeech(); speechStatus.textContent = 'Word audio failed to start. Please retry.'; }
});
textarea.addEventListener('input', refreshText);
get<HTMLButtonElement>('#lookup-retry').addEventListener('click', refreshText);
app.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach(button => button.addEventListener('click', () => {
  occurrences = [];
  textarea.value = button.dataset.sample!;
  refreshText();
}));
Object.values(settings).forEach(setting => setting.addEventListener('change', updatePresentation));
override.addEventListener('change', () => {
  if (selected !== null) occurrences[selected].override = override.value as HintOverride;
  updatePresentation();
});
progress.addEventListener('input', () => { if (selected !== null) activate(selected, Number(progress.value)); });
reset.addEventListener('click', () => {
  if (selected !== null) occurrences[selected].active = null;
  updatePresentation();
});
if (speechSupported) window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
window.addEventListener('pagehide', stopSpeech);
window.addEventListener('resize', updatePresentation);
void document.fonts.ready.then(updatePresentation);
refreshText();
refreshVoices();
