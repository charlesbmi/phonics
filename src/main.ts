import { Lexicon, hasLetterGroups, normalizeWord } from './lexicon';
import { installFontPicker } from './font-picker';
import { installRecordedReading } from './recorded-reading';
import type { RecordedReading, RecordingSelection } from './recorded-reading';
import type { AlignmentReview } from './alignment-review';
import type { LexiconEntry } from './lexicon';
import '../shared/reader.css';
import './style.css';
import { hasBlendingCues, hintsVisible, soundAtClientX, soundEvents, soundLetters, soundCueBounds, groupSoundIndices, tokenize } from './model';
import type { HintOverride, WordEntry, TeachingUnit } from './model';

const lexicon = new Lexicon(new URL(import.meta.env.BASE_URL, location.href));
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <main class="app-shell">
    <header class="app-header">
      <h1>Little Reader</h1>
      <span class="badge">US English</span>
    </header>
    <section id="review-root" class="panel" hidden></section>
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
        <span data-legend="unclassified" hidden><i class="legend-unclassified" aria-hidden="true">?</i>No blending cue</span>
        <span data-legend="group" hidden><i class="legend-group" aria-hidden="true"></i>Letter group</span>
        <span data-legend="silent" hidden><i class="legend-silent" aria-hidden="true">e</i>No added sound</span>
        <span data-legend="split" hidden><svg class="legend-split" viewBox="0 0 26 11" aria-hidden="true"><path d="M 1 1 Q 13 19 25 1"/></svg>Split spelling</span>
        <span data-legend="long" hidden><i class="legend-long" aria-hidden="true"></i>Long vowel</span>
        <span data-legend="vowel" hidden><i class="legend-vowel" aria-hidden="true">a</i>Vowel</span>
        <span data-legend="consonant" hidden><i class="legend-consonant" aria-hidden="true">b</i>Consonant</span>
      </div>
    </section>
    <section id="selected-panel" class="panel" aria-labelledby="selected-heading" hidden>
      <div class="toolbar"><h2 id="selected-heading"></h2><div class="word-tools"><button id="speak" class="primary" disabled>▶ Hear word</button><button id="stop-audio" hidden>Stop</button></div></div>
      <div id="word-tools" class="word-tools" hidden>
        <label for="hint-override">Hints</label><select id="hint-override"><option value="default">Default</option><option value="show">Show</option><option value="hide">Hide</option></select>
        <button id="reset-progress">Show whole word</button>
      </div>
      <label id="pronunciation-control" hidden>Pronunciation <select id="pronunciation-choice" aria-label="Word pronunciation"></select></label>
      <div id="touch-sounds" class="touch-sounds" role="group" aria-label="Silent sound steps" hidden></div>
      <div id="scrubber" class="scrubber" hidden><label for="sound-progress">Sound guide (silent)</label><input id="sound-progress" type="range" min="0" value="0" step="1"/><span id="sound-count" class="selected-sound"></span></div>
      <div id="recorded-reading" hidden></div>
      <p id="word-status" class="status" aria-live="polite"></p>
      <p id="speech-status" class="status" role="status" aria-live="polite"></p>
    </section>
    <details class="panel parent-tools">
      <summary>Settings</summary>
      <div id="font-control"></div>
      <div class="control-grid">
        <label><input type="checkbox" id="hints" checked>Hints by default</label>
        <label><input type="checkbox" id="rail" checked>Rail</label>
        <label><input type="checkbox" id="groups" checked>Letter groups</label>
        <label><input type="checkbox" id="macrons">Long-vowel marks</label>
        <label><input type="checkbox" id="colors">Colors</label>
      </div>
      <p class="tools-note"><a href="?review=alignments">Review missing hints</a></p>
      <p class="muted tools-note">Word controls can override these hints. Unsupported words stay unmarked.</p>
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
const stopButton = get<HTMLButtonElement>('#stop-audio');
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
  baseEntry?: LexiconEntry;
  variantId?: string;
  connectors: Array<{ element: HTMLSpanElement | SVGSVGElement; unit: TeachingUnit; vowelMark?: HTMLSpanElement }>;
  wrapper: HTMLSpanElement;
  button: HTMLButtonElement;
  rail?: HTMLDivElement;
  graphemes: HTMLSpanElement[];
  cues: HTMLButtonElement[];
  override: HintOverride;
  active: number | null;
}
let recorded: RecordedReading | undefined;
let recordedPlaying = false;
let alignmentReview: AlignmentReview | undefined;
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
  return !speechSupported ? 'System voice unavailable in this browser.' : !voice ? 'No US English system voice available.' : '';
}

function selectWord(index: number): void {
  stopSpeech();
  speechStatus.textContent = audioAvailabilityMessage();
  if (selected !== null) occurrences[selected].active = null;
  selected = selected === index ? null : index;
  if (selected !== null) occurrences[selected].active = null;
  updatePresentation();
}
function activate(index: number, sound: number, audition = false): void {
  if (retainedUtterance || recorded?.isPlaying() || recorded?.isBusy()) stopSpeech();
  speechStatus.textContent = audioAvailabilityMessage();
  selected = index;
  occurrences[index].active = sound;
  updatePresentation();
  if (audition) void recorded?.playFromPhone(sound);
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
    const candidate = alignmentReview?.lookup(token.text) ?? lexicon.lookup(token.text);
    const prior = previous[index];
    const baseEntry = candidate;
    const variantId = prior?.text === token.text ? prior.variantId ?? baseEntry?.primaryVariantId : baseEntry?.primaryVariantId;
    const variant = baseEntry?.variants?.find(variant => variant.id === variantId);
    const alignment = variantId && variantId !== baseEntry?.primaryVariantId ? variant?.entry : hasLetterGroups(baseEntry) ? baseEntry : undefined;
    // An incomplete entry is treated as unknown rather than guessing a mapping.
    const entry = alignment && alignment.groups.map(g => g.text).join('').toLowerCase() === normalizeWord(token.text) ? alignment : undefined;
    const wrapper = document.createElement('span');
    wrapper.className = entry ? 'word' : 'word word-unknown';
    wrapper.dataset.occurrence = String(index);
    const button = document.createElement('button');
    button.className = 'word-button';
    button.setAttribute('aria-label', `Select ${token.text}, word ${index + 1}`);
    button.addEventListener('click', () => selectWord(index));
    const letters = document.createElement('span');
    letters.className = 'graphemes';
    const occurrence: Occurrence = { text: token.text, entry, lexiconEntry: candidate, baseEntry, variantId, connectors: [], wrapper, button, graphemes: [], cues: [], override: prior?.text === token.text ? prior.override : 'default', active: preserveSelection ? prior?.active ?? null : null };
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
      const sounds = soundEvents(entry);
      sounds.forEach((sound, soundIndex) => {
        const cue = document.createElement('button');
        cue.className = `cue cue-${sound.cue ?? 'unclassified'}`;
        cue.setAttribute('aria-label', `${token.text}: letters ${soundLetters(entry, sound)}, sound ${soundIndex + 1} of ${sounds.length}, ${sound.cue ?? 'unclassified'}`);
        cue.addEventListener('click', event => { if (event.detail === 0) activate(index, soundIndex, true); });
        occurrence.cues.push(cue);
        rail.append(cue);
      });
      // Pointer capture keeps finger/mouse scrubbing on this rail until release.
      // https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture
      const scrub = (event: PointerEvent) => {
        activate(index, soundAtClientX(event.clientX, occurrence.cues.map(cue => cue.getBoundingClientRect().right)));
      };
      let pointerStart: number | null = null;
      let pointerMoved = false;
      rail.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        pointerStart = event.clientX;
        pointerMoved = false;
        rail.setPointerCapture(event.pointerId);
        scrub(event);
      });
      rail.addEventListener('pointermove', event => {
        if (rail.hasPointerCapture(event.pointerId)) {
          if (pointerStart !== null && Math.abs(event.clientX - pointerStart) >= 6) pointerMoved = true;
          scrub(event);
        }
      });
      rail.addEventListener('pointerup', event => {
        const tapped = !pointerMoved && pointerStart !== null && Math.abs(event.clientX - pointerStart) < 6;
        pointerStart = null;
        if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
        if (tapped && selected === index) void recorded?.playFromPhone(occurrence.active ?? 0);
      });
      rail.addEventListener('pointercancel', () => { pointerStart = null; stopSpeech(); });
      rail.addEventListener('lostpointercapture', () => { if (pointerStart !== null) { pointerStart = null; stopSpeech(); } });
      occurrence.rail = rail;
    } else {
      letters.textContent = token.text;
    }
    button.append(letters);
    wrapper.append(button);
    for (const unit of entry?.teachingUnits ?? []) {
      const split = unit.patternId.startsWith('split-');
      const connector = split ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement('span');
      connector.setAttribute('class', `teaching-connector${split ? ' split-connector' : ''}`);
      connector.setAttribute('aria-hidden', 'true');
      if (split) connector.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
      wrapper.append(connector);
      let vowelMark: HTMLSpanElement | undefined;
      if (unit.vowel === 'long') {
        vowelMark = document.createElement('span');
        vowelMark.className = 'unit-vowel-mark';
        vowelMark.setAttribute('aria-hidden', 'true');
        wrapper.append(vowelMark);
      }
      occurrence.connectors.push({ element: connector, unit, vowelMark });
    }
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
    const sounds = soundEvents(word.entry);
    const activeGroups = new Set(word.active === null ? [] : sounds[word.active]?.groupIndices ?? []);
    for (const unit of word.entry?.teachingUnits ?? []) {
      if (word.active !== null && unit.phoneIndices.includes(word.active)) unit.groupIndices.forEach(group => activeGroups.add(group));
    }
    const base = word.button.getBoundingClientRect().left;
    const bounds = word.graphemes.map(grapheme => {
      const rect = grapheme.getBoundingClientRect();
      return { left: rect.left - base, right: rect.right - base };
    });
    if (word.rail && word.entry) {
      word.rail.hidden = !show || !settings.rail.checked;
      soundCueBounds(word.entry, bounds).forEach((rect, soundIndex) => {
        const cue = word.cues[soundIndex];
        cue.style.left = `${rect.left}px`;
        cue.style.width = `${rect.width}px`;
        cue.classList.toggle('active', isSelected && word.active === soundIndex);
        cue.setAttribute('aria-pressed', String(isSelected && word.active === soundIndex));
      });
    }
    word.graphemes.forEach((grapheme, groupIndex) => {
      const group = word.entry!.groups[groupIndex];
      const linked = groupSoundIndices(word.entry!, groupIndex);
      const units = word.entry?.teachingUnits?.filter(unit => unit.groupIndices.includes(groupIndex)) ?? [];
      const taught = units.length > 0;
      const independentSilent = !!group.silent && !taught;
      const vowel = group.vowel ?? units.find(unit => unit.vowel !== null)?.vowel ?? (linked.some(index => sounds[index].vowel !== null) ? 'other' : null);
      grapheme.classList.toggle('group-link', show && settings.groups.checked && !taught && !group.silent && linked.length === 1 && group.text.length > 1);
      grapheme.classList.toggle('silent-letter', show && settings.groups.checked && independentSilent);
      grapheme.classList.toggle('vowel-long', show && settings.macrons.checked && group.vowel === 'long' && !units.some(unit => unit.vowel === 'long'));
      grapheme.classList.toggle('letter-vowel', show && settings.colors.checked && !independentSilent && vowel !== null);
      grapheme.classList.toggle('letter-consonant', show && settings.colors.checked && !independentSilent && vowel === null);
      grapheme.classList.toggle('active', show && isSelected && activeGroups.has(groupIndex));
      grapheme.classList.toggle('pending', !recordedPlaying && show && isSelected && word.active !== null && linked.length > 0 && linked.every(index => index > word.active!));
    });
    for (const { element, unit, vowelMark } of word.connectors) {
      element.toggleAttribute('hidden', !show || !settings.groups.checked);
      const linked = unit.groupIndices.map(index => bounds[index]);
      const left = Math.min(...linked.map(rect => rect.left));
      const right = Math.max(...linked.map(rect => rect.right));
      if (element instanceof SVGSVGElement) {
        const first = bounds[unit.groupIndices[0]];
        const last = bounds[unit.groupIndices[unit.groupIndices.length - 1]];
        const start = (first.left + first.right) / 2;
        const end = (last.left + last.right) / 2;
        const width = Math.max(1, end - start);
        const height = Math.max(8, parseFloat(getComputedStyle(word.button).fontSize) * .22);
        element.style.left = `${start}px`;
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
        element.setAttribute('viewBox', `0 0 ${width} ${height}`);
        element.querySelector('path')!.setAttribute('d', `M 0 1 Q ${width / 2} ${height * 1.7} ${width} 1`);
      } else {
        element.style.left = `${left + 2}px`;
        element.style.width = `${Math.max(0, right - left - 4)}px`;
      }
      if (vowelMark) {
        vowelMark.hidden = !show || !settings.macrons.checked;
        const markBounds = unit.patternId.startsWith('split-') ? bounds[unit.groupIndices[0]] : { left, right };
        vowelMark.style.left = `${markBounds.left + (markBounds.right - markBounds.left) * .24}px`;
        vowelMark.style.width = `${(markBounds.right - markBounds.left) * .52}px`;
      }
    }
  });
  // Describe marks actually rendered, including occurrence-specific overrides.
  // Checking only the global toggles would give the wrong key for a hidden word,
  // an unknown word, or a local Show override while default hints are off.
  const legend = get<HTMLDivElement>('#hint-legend');
  const visibleMarks: Record<string, string> = {
    quick: '.sound-rail:not([hidden]) .cue-quick',
    stretch: '.sound-rail:not([hidden]) .cue-stretch',
    unclassified: '.sound-rail:not([hidden]) .cue-unclassified',
    group: '.group-link, .teaching-connector:not([hidden]):not(.split-connector)',
    silent: '.silent-letter',
    split: '.split-connector:not([hidden])',
    long: '.vowel-long, .unit-vowel-mark:not([hidden])',
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
  const audibleGuide = recorded?.canPlayFromPhone() ?? false;
  get<HTMLLabelElement>('label[for="sound-progress"]').textContent = audibleGuide ? 'Sound guide — Enter to hear' : 'Sound guide (silent)';
  const touchSounds = get<HTMLDivElement>('#touch-sounds');
  touchSounds.setAttribute('aria-label', audibleGuide ? 'Hear from a sound — timing preview' : 'Silent sound steps');
  touchSounds.hidden = !soundEvents(word?.entry).length || !show || !settings.rail.checked;
  if (touchControlsFor !== selected) {
    touchControlsFor = selected;
    touchSounds.replaceChildren();
    const index = selected;
    if (word?.entry && index !== null) {
      const sounds = soundEvents(word.entry);
      sounds.forEach((sound, soundIndex) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = soundLetters(word.entry!, sound);
        button.setAttribute('aria-label', `Letters ${soundLetters(word.entry!, sound)}, sound ${soundIndex + 1} of ${sounds.length}, ${sound.cue ?? 'unclassified'}`);
        button.addEventListener('click', () => activate(index, soundIndex, true));
        touchSounds.append(button);
      });
    }
  }
  touchSounds.querySelectorAll('button').forEach((button, index) => button.setAttribute('aria-pressed', String(word?.active === index)));
  scrubber.hidden = !soundEvents(word?.entry).length || !show || !settings.rail.checked;
  reset.disabled = !word?.entry || word.active === null;
  if (word?.entry) {
    const sounds = soundEvents(word.entry);
    progress.max = String(sounds.length - 1);
    progress.value = String(word.active ?? 0);
    const sound = sounds[word.active ?? 0];
    progress.setAttribute('aria-valuetext', `Letters ${soundLetters(word.entry, sound)}, sound ${(word.active ?? 0) + 1} of ${sounds.length}, ${sound.cue ?? 'unclassified'}`);
    count.textContent = word.active === null ? `${sounds.length} sounds` : `Sound ${word.active + 1} of ${sounds.length}`;
  }
  if (!word) wordStatus.textContent = '';
  else if (!word.entry) {
    wordStatus.textContent = word.variantId && word.variantId !== word.baseEntry?.primaryVariantId ? 'Letter hints are not available for this pronunciation yet.'
      : word.lexiconEntry && 'reason' in word.lexiconEntry && word.lexiconEntry.reason === 'alignment-review' ? 'Pronunciation found; its letter alignment needs review.'
      : word.lexiconEntry ? 'Pronunciation found; letter hints are not available yet.'
      : lookupPending ? 'Loading hints…'
      : lookupFailed ? 'Hints could not load. Please retry.'
      : 'Word not found in this dictionary.';
  } else wordStatus.textContent = !show ? 'Hints hidden.' : !hasBlendingCues(word.entry) ? 'No quick/stretch cue yet for sounds marked ?.' : '';
  const variantControl = get<HTMLLabelElement>('#pronunciation-control');
  const variantSelect = get<HTMLSelectElement>('#pronunciation-choice');
  const variants = word?.baseEntry?.variants ?? [];
  const displayVariants = variants.filter((variant, index) => variants.findIndex(other => other.pronunciation.join(' ') === variant.pronunciation.join(' ')) === index);
  variantControl.hidden = displayVariants.length < 2;
  const signature = displayVariants.map(variant => variant.id).join('|');
  if (variantSelect.dataset.variants !== signature) {
    variantSelect.replaceChildren(...displayVariants.map((variant, index) => {
      const option = document.createElement('option');
      option.value = variant.id;
      const sameSounds = displayVariants.filter(other => other.phonemes.join('') === variant.phonemes.join('')).length > 1;
      const vowelStress = variant.pronunciation.filter(phone => /[012]$/.test(phone));
      const primaryVowels = vowelStress.flatMap((phone, i) => phone.endsWith('1') ? [i + 1] : []);
      const stress = sameSounds ? ` · stress on vowel ${primaryVowels.join(', ') || 'not specified'}` : '';
      option.textContent = `${index + 1}: /${variant.phonemes.join('')}/${stress}${variant.aligned ? '' : ' — no letter hints yet'}`;
      option.title = variant.pronunciation.join(' ');
      return option;
    }));
    variantSelect.dataset.variants = signature;
  }
  variantSelect.value = word?.variantId ?? word?.baseEntry?.primaryVariantId ?? '';
  if (word && displayVariants.length > 1 && !wordStatus.textContent) wordStatus.textContent = 'More than one pronunciation. Hints use the dictionary default unless changed.';
  if (word && word.variantId && word.variantId !== word.baseEntry?.primaryVariantId) wordStatus.textContent += ' Word audio uses the device pronunciation.';
  speak.disabled = !word || !voice;
  stopButton.hidden = !retainedUtterance && !recordedPlaying && !recorded?.isBusy();
  recorded?.sync();
}
function stopSystemSpeech(): void {
  speechGeneration++;
  clearTimeout(speechTimer);
  if (speechSupported) window.speechSynthesis.cancel();
  retainedUtterance = undefined;
}
function stopSpeech(): void {
  stopSystemSpeech();
  recorded?.stop();
}
function refreshVoices(): void {
  // Voices can arrive asynchronously via voiceschanged.
  // https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices
  if (!speechSupported) {
    speechStatus.textContent = 'System voice is unavailable in this browser.';
    return;
  }
  voice = window.speechSynthesis.getVoices().find(candidate => candidate.lang.replace('_', '-').toLowerCase() === 'en-us');
  speechStatus.textContent = voice ? '' : 'No US English system voice available. Check your browser’s voice settings.';
  updatePresentation();
}
speak.addEventListener('click', () => {
  const word = selected === null ? undefined : occurrences[selected];
  if (!word || !voice) return;
  stopSpeech();
  const generation = speechGeneration;
  const utterance = new SpeechSynthesisUtterance(word.text);
  retainedUtterance = utterance;
  updatePresentation();
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
    updatePresentation();
  };
  // https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/error_event
  utterance.onerror = (event) => {
    if (generation !== speechGeneration) return;
    clearTimeout(speechTimer);
    speechStatus.textContent = `Word audio failed (${event.error}). Tap Hear word to retry.`;
    retainedUtterance = undefined;
    updatePresentation();
  };
  speechTimer = setTimeout(() => {
    if (generation !== speechGeneration) return;
    stopSpeech();
    speechStatus.textContent = 'Word audio did not start. Check your browser’s voice settings and retry.';
  }, 8000);
  try { window.speechSynthesis.speak(retainedUtterance); }
  catch { stopSpeech(); speechStatus.textContent = 'Word audio failed to start. Please retry.'; }
});
stopButton.addEventListener('click', () => { stopSpeech(); speechStatus.textContent = 'Stopped.'; updatePresentation(); });
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
get<HTMLSelectElement>('#pronunciation-choice').addEventListener('change', event => {
  if (selected === null) return;
  occurrences[selected].variantId = (event.target as HTMLSelectElement).value;
  occurrences[selected].active = null;
  renderText(true);
});
progress.addEventListener('keydown', event => {
  if ((event.key === 'Enter' || event.key === ' ') && recorded?.canPlayFromPhone()) { event.preventDefault(); void recorded.playFromPhone(Number(progress.value)); }
});
progress.addEventListener('input', () => { if (selected !== null) activate(selected, Number(progress.value)); });
reset.addEventListener('click', () => {
  stopSpeech();
  if (selected !== null) occurrences[selected].active = null;
  updatePresentation();
});
if (speechSupported) window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
window.addEventListener('pagehide', stopSpeech);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopSpeech(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { stopSpeech(); updatePresentation(); } });
window.addEventListener('resize', updatePresentation);
void document.fonts.ready.then(updatePresentation);
recorded = installRecordedReading(get<HTMLElement>('#recorded-reading'), {
  baseUrl: new URL(import.meta.env.BASE_URL, location.href),
  getSelection(): RecordingSelection | undefined {
    const word = selected === null ? undefined : occurrences[selected];
    if (!word?.entry || selected === null) return undefined;
    const variantId = word.variantId ?? word.baseEntry?.primaryVariantId ?? normalizeWord(word.text);
    const variant = word.baseEntry?.variants?.find(item => item.id === variantId);
    return { key: `${selected}:${word.text}:${variantId}`, word: word.text, variantId,
      phonemes: soundEvents(word.entry).map(sound => sound.phoneme), phones: variant?.pronunciation, active: word.active };
  },
  onPhone(index) { if (selected !== null && occurrences[selected]) { occurrences[selected].active = index; updatePresentation(); } },
  onPlaying(playing) { recordedPlaying = playing; updatePresentation(); },
  stopOtherAudio: stopSystemSpeech,
});
refreshText();
refreshVoices();
installFontPicker(get<HTMLElement>('#font-control'), reader, updatePresentation);

if (new URLSearchParams(location.search).get('review') === 'alignments') {
  const reviewRoot = get<HTMLElement>('#review-root');
  reviewRoot.hidden = false;
  reviewRoot.textContent = 'Loading alignment review…';
  void import('./alignment-review').then(async ({ installAlignmentReview }) => {
    alignmentReview = await installAlignmentReview(reviewRoot, word => {
      occurrences = [];
      textarea.value = word;
      refreshText();
    });
    const readingSection = get<HTMLElement>('section[aria-labelledby="reading-heading"]');
    const reason = reviewRoot.querySelector('[data-review=reason]');
    reviewRoot.insertBefore(readingSection, reason);
    get<HTMLElement>('section[aria-labelledby="text-heading"]').hidden = true;
    textarea.value = alignmentReview.currentWord;
    occurrences = [];
    refreshText();
  }).catch(() => { reviewRoot.textContent = 'The alignment review could not load. Reload to retry.'; });
}
