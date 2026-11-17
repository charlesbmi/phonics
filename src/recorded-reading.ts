import { AudioController } from './audio-controller';
import type { RecordingAsset } from './audio-controller';
import { normalizeWord } from './lexicon';

interface LinkedRecording extends RecordingAsset { graphPhonemes: readonly string[] }
export interface RecordingSelection {
  key: string;
  word: string;
  variantId: string;
  phonemes: readonly string[];
  phones?: readonly string[];
  active: number | null;
}
interface Options {
  baseUrl: URL;
  getSelection: () => RecordingSelection | undefined;
  onPhone: (index: number | null) => void;
  onPlaying: (playing: boolean) => void;
  stopOtherAudio: () => void;
}
export interface RecordedReading {
  sync(): void;
  stop(): void;
  playFromPhone(index: number): Promise<void>;
  canPlayFromPhone(): boolean;
  isPlaying(): boolean;
  isBusy(): boolean;
  dispose(): void;
}

export function installRecordedReading(container: HTMLElement, options: Options): RecordedReading {
  container.className = 'recorded-reading';
  container.hidden = true;
  container.innerHTML = `<div class="word-tools"><button type="button" data-recording="word">Hear recording</button><button type="button" data-recording="phone" disabled>Hear from this sound</button><a data-recording="credits">Recording credits</a></div><label class="recording-timing"><input type="checkbox" data-recording="timing">Follow sounds — timing preview</label><p class="muted" data-recording="note">Recording and timing candidates need listening review.</p><p class="status" data-recording="status" role="status" aria-live="polite"></p>`;
  const get = <T extends HTMLElement>(name: string) => container.querySelector<T>(`[data-recording="${name}"]`)!;
  const wordButton = get<HTMLButtonElement>('word');
  const phoneButton = get<HTMLButtonElement>('phone');
  const preview = get<HTMLInputElement>('timing');
  const status = get<HTMLElement>('status');
  get<HTMLAnchorElement>('credits').href = new URL('audio/ATTRIBUTION.txt', options.baseUrl).href;
  let key = '';
  let generation = 0;
  let selectionGeneration = 0;
  let playing = false;
  let busy = false;
  let suppressPhone = false;
  let asset: LinkedRecording | undefined;
  let words: Record<string, LinkedRecording> | undefined;
  let manifestRequest: Promise<Record<string, LinkedRecording>> | undefined;

  const setPlaying = (value: boolean) => {
    playing = value;
    options.onPlaying(value);
  };
  const controller = new AudioController({
    baseUrl: options.baseUrl,
    onPhone(index) { if (!suppressPhone && options.getSelection()?.key === key) options.onPhone(index); },
    onStatus(state, message) {
      status.textContent = message;
      setPlaying(state === 'playing');
    },
  });
  const matches = (record: LinkedRecording, selection: RecordingSelection) => record.variantId === selection.variantId
    && record.graphPhonemes?.length === selection.phonemes.length
    && record.graphPhonemes.every((phone, index) => phone === selection.phonemes[index])
    && (!selection.phones || (selection.phones.length === record.phones.length && selection.phones.every((phone, index) => phone === record.phones[index])));

  async function loadManifest(): Promise<Record<string, LinkedRecording>> {
    if (words) return words;
    if (!manifestRequest) manifestRequest = (async () => {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 20_000);
      try {
        const response = await fetch(new URL('audio/manifest.json', options.baseUrl), { cache: 'no-cache', signal: abort.signal });
        if (!response.ok) throw Error('Recording metadata unavailable');
        const manifest = await response.json();
        if (manifest.schemaVersion !== 1 || !manifest.words) throw Error('Recording metadata invalid');
        words = manifest.words;
        return words!;
      } catch {
        throw Error('Recording previews could not load. Tap Hear recording to retry.');
      } finally { clearTimeout(timeout); }
    })().finally(() => { manifestRequest = undefined; });
    return manifestRequest;
  }
  function controls(): void {
    phoneButton.disabled = !asset || !preview.checked || asset.events?.length !== asset.phones.length;
    preview.closest('label')!.hidden = !asset?.events?.length;
  }
  async function syncAsset(selection: RecordingSelection, current: number): Promise<void> {
    try {
      const available = await loadManifest();
      if (current !== selectionGeneration || options.getSelection()?.key !== selection.key) return;
      const word = normalizeWord(selection.word);
      const record = Object.hasOwn(available, word) ? available[word] : undefined;
      asset = record && matches(record, selection) ? record : undefined;
      container.hidden = !asset;
      if (asset) {
        status.textContent = '';
        get('note').textContent = asset.review.status === 'reviewed' ? 'Recorded word audio.' : 'Recording and timing candidates need listening review.';
      }
      controls();
    } catch (error) {
      if (current !== selectionGeneration || options.getSelection()?.key !== selection.key) return;
      container.hidden = false;
      status.textContent = error instanceof Error ? error.message : 'Recording previews could not load.';
    }
  }
  function stop(): void {
    generation++;
    busy = false;
    controller.stop();
    if (!suppressPhone && options.getSelection()?.key === key) options.onPhone(null);
    setPlaying(false);
    status.textContent = '';
  }
  async function play(phoneIndex?: number): Promise<void> {
    const selection = options.getSelection();
    if (!selection) return;
    options.stopOtherAudio();
    controller.stop();
    options.onPhone(null);
    busy = true;
    setPlaying(false);
    // Resume directly in this intentional gesture, before any async asset work.
    const unlocked = controller.unlock();
    const current = ++generation;
    try {
      const available = await loadManifest();
      if (current !== generation || options.getSelection()?.key !== selection.key) return;
      const record = Object.hasOwn(available, normalizeWord(selection.word)) ? available[normalizeWord(selection.word)] : undefined;
      if (!record || !matches(record, selection)) { status.textContent = 'No recording for this pronunciation.'; return; }
      asset = record;
      controls();
      if (phoneIndex !== undefined && (!preview.checked || record.events?.length !== record.phones.length)) return;
      const enabled = await unlocked;
      if (!enabled || current !== generation || options.getSelection()?.key !== selection.key) return;
      const ready = await controller.prepare(record, { variantId: selection.variantId, phones: selection.phones ?? record.phones }, { previewTiming: preview.checked });
      if (!ready || current !== generation || options.getSelection()?.key !== selection.key) return;
      if (phoneIndex === undefined) controller.playWord();
      else controller.playFromPhone(phoneIndex);
    } catch (error) {
      if (current === generation) status.textContent = error instanceof Error ? error.message : 'The recording could not play. Tap to retry.';
    } finally {
      if (current === generation) { busy = false; options.onPlaying(playing); }
    }
  }
  wordButton.addEventListener('click', () => { void play(); });
  phoneButton.addEventListener('click', () => { void play(options.getSelection()?.active ?? 0); });
  preview.addEventListener('change', () => { stop(); controls(); });
  return {
    sync() {
      const selection = options.getSelection();
      const next = selection?.key ?? '';
      if (next === key) return;
      key = next;
      selectionGeneration++;
      asset = undefined;
      preview.checked = false;
      container.hidden = true;
      controls();
      suppressPhone = true;
      stop();
      suppressPhone = false;
      if (selection) void syncAsset(selection, selectionGeneration);
    },
    stop,
    async playFromPhone(index) { if (asset && preview.checked) await play(index); },
    canPlayFromPhone: () => !!asset && preview.checked && asset.events?.length === asset.phones.length,
    isPlaying: () => playing,
    isBusy: () => busy,
    dispose() { stop(); controller.dispose(); },
  };
}
