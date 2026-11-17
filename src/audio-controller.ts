/** Static, recorded-word playback. No timing is inferred from spelling or layout. */
export interface PhoneEvent {
  phoneIndex: number;
  startFrame: number;
  endFrame: number;
}

export interface RecordingAsset {
  word: string;
  variantId: string;
  phones: readonly string[];
  audioUrl: string;
  /** SHA-256 of the complete processed PCM WAV file, before browser decoding. */
  sha256: string;
  sampleRate: number;
  frameCount: number;
  events?: readonly PhoneEvent[];
  review: { status: 'candidate' | 'reviewed'; [key: string]: unknown };
}

export interface ExpectedPronunciation {
  variantId: string;
  phones: readonly string[];
}

export type AudioStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'gesture-required' | 'error';
interface ControllerOptions {
  baseUrl: URL;
  onPhone: (phoneIndex: number | null) => void;
  onStatus: (status: AudioStatus, message: string) => void;
}

/** Injectable browser boundaries keep cancellation and clock behavior testable. */
interface AudioEnvironment {
  createContext: () => AudioContext;
  fetch: typeof fetch;
  sha256: (bytes: ArrayBuffer) => Promise<string>;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
}

function browserEnvironment(): AudioEnvironment {
  return {
    createContext: () => new AudioContext(),
    fetch: (...args) => globalThis.fetch(...args),
    sha256: async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(byte => byte.toString(16).padStart(2, '0')).join(''),
    requestFrame: callback => requestAnimationFrame(callback),
    cancelFrame: id => cancelAnimationFrame(id),
  };
}

function validateAsset(record: RecordingAsset, expected: ExpectedPronunciation): void {
  if (!record || !record.word || !record.audioUrl || !record.variantId
    || record.variantId !== expected.variantId || !Array.isArray(record.phones)
    || !record.phones.length || record.phones.length !== expected.phones.length
    || record.phones.some((phone, index) => typeof phone !== 'string' || phone !== expected.phones[index])) {
    throw new Error('The recording does not match this pronunciation.');
  }
  if (!/^[a-f\d]{64}$/i.test(record.sha256)
    || !Number.isSafeInteger(record.sampleRate) || record.sampleRate <= 0
    || !Number.isSafeInteger(record.frameCount) || record.frameCount <= 0
    || !record.review || !['candidate', 'reviewed'].includes(record.review.status)) {
    throw new Error('The recording metadata is invalid.');
  }
  const events = record.events ?? [];
  if (!Array.isArray(events) || (events.length !== 0 && events.length !== record.phones.length)
    || (record.review.status === 'reviewed' && events.length !== record.phones.length)) {
    throw new Error('The recording must have one interval per sound.');
  }
  let priorEnd = 0;
  for (const [index, event] of events.entries()) {
    if (!event || event.phoneIndex !== index || !Number.isSafeInteger(event.startFrame)
      || !Number.isSafeInteger(event.endFrame) || event.startFrame < priorEnd
      || event.endFrame <= event.startFrame || event.endFrame > record.frameCount) {
      throw new Error('The recording has invalid or overlapping sound intervals.');
    }
    priorEnd = event.endFrame;
  }
}

/** Check processed-file frames before decodeAudioData can resample them. */
function validateWav(bytes: ArrayBuffer, record: RecordingAsset): void {
  const view = new DataView(bytes);
  const text = (offset: number, count: number) => Array.from({ length: count }, (_, i) =>
    String.fromCharCode(view.getUint8(offset + i))).join('');
  if (view.byteLength < 44 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE'
    || view.getUint32(4, true) + 8 !== view.byteLength) {
    throw new Error('The processed recording is not a complete PCM WAV file.');
  }
  let sampleRate = 0, blockAlign = 0, dataBytes = -1;
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const tag = text(offset, 4);
    const length = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (length > view.byteLength - body) throw new Error('The WAV file is truncated.');
    if (tag === 'fmt ') {
      if (length < 16 || sampleRate) throw new Error('The WAV format metadata is invalid.');
      const encoding = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      blockAlign = view.getUint16(body + 12, true);
      const bits = view.getUint16(body + 14, true);
      if (![1, 3].includes(encoding) || channels < 1 || bits < 8 || bits % 8 !== 0
        || blockAlign !== channels * bits / 8) throw new Error('The WAV must contain PCM samples.');
    } else if (tag === 'data') {
      if (dataBytes !== -1) throw new Error('The WAV has multiple audio chunks.');
      dataBytes = length;
    }
    offset = body + length + length % 2;
  }
  if (sampleRate !== record.sampleRate || blockAlign === 0 || dataBytes <= 0
    || dataBytes % blockAlign !== 0 || dataBytes / blockAlign !== record.frameCount) {
    throw new Error('The processed WAV frames do not match the recording metadata.');
  }
}

interface PreparedRecording {
  record: RecordingAsset;
  buffer: AudioBuffer;
  previewTiming: boolean;
}
interface Playback {
  source: AudioBufferSourceNode;
  gain: GainNode;
  generation: number;
}

export class AudioController {
  private readonly options: ControllerOptions;
  private readonly env: AudioEnvironment;
  private context: AudioContext | null = null;
  private prepared: PreparedRecording | null = null;
  private pending: AbortController | null = null;
  private playback: Playback | null = null;
  private frame: number | null = null;
  private generation = 0;
  private prepareGeneration = 0;
  private unlockGeneration = 0;
  private disposed = false;
  private activePhone: number | null = null;

  constructor(options: ControllerOptions, environment: Partial<AudioEnvironment> = {}) {
    this.options = options;
    this.env = { ...browserEnvironment(), ...environment };
  }

  private status(status: AudioStatus, message: string): void {
    if (!this.disposed) this.options.onStatus(status, message);
  }

  private phone(index: number | null): void {
    if (index === this.activePhone) return;
    this.activePhone = index;
    this.options.onPhone(index);
  }

  private audioContext(): AudioContext {
    if (!this.context) this.context = this.env.createContext();
    return this.context;
  }

  /** Call directly inside an intentional user gesture, before awaiting any fetch. */
  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    const generation = ++this.unlockGeneration;
    try {
      const context = this.audioContext();
      // resume() must be requested in the gesture, not after preparation completes.
      // https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume
      if (context.state !== 'running') await context.resume();
      if (this.disposed || generation !== this.unlockGeneration) return false;
      if (context.state !== 'running') {
        this.status('gesture-required', 'Audio is paused. Tap Hear again to try enabling sound.');
        return false;
      }
      return true;
    } catch {
      if (!this.disposed && generation === this.unlockGeneration) {
        this.status('gesture-required', 'Sound could not be enabled. Tap Hear again to retry.');
      }
      return false;
    }
  }

  /** Loading is silent. Candidate intervals require an explicit preview opt-in. */
  async prepare(record: RecordingAsset, expected: ExpectedPronunciation,
    options: { previewTiming?: boolean } = {}): Promise<boolean> {
    if (this.disposed) return false;
    this.stopWork();
    const generation = this.prepareGeneration;
    let abort: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      validateAsset(record, expected);
      // Clone the manifest so changing callers cannot change an in-flight session.
      const snapshot: RecordingAsset = structuredClone(record);
      const prior = this.prepared;
      this.prepared = null;
      if (prior && prior.record.sha256 === snapshot.sha256
        && prior.record.audioUrl === snapshot.audioUrl && prior.record.variantId === snapshot.variantId
        && prior.record.sampleRate === snapshot.sampleRate && prior.record.frameCount === snapshot.frameCount) {
        this.prepared = { record: snapshot, buffer: prior.buffer, previewTiming: options.previewTiming === true };
        this.status('ready', 'Recording ready. Tap Hear to listen.');
        return true;
      }
      abort = new AbortController();
      this.pending = abort;
      timeout = setTimeout(() => { timedOut = true; abort?.abort(); }, 20_000);
      this.status('loading', 'Loading recording…');
      const response = await this.env.fetch(new URL(snapshot.audioUrl, this.options.baseUrl), { signal: abort.signal });
      if (!response.ok) throw new Error('The recording could not be downloaded.');
      const bytes = await response.arrayBuffer();
      if (this.disposed || generation !== this.prepareGeneration) return false;
      if ((await this.env.sha256(bytes)).toLowerCase() !== snapshot.sha256.toLowerCase()) {
        throw new Error('The recording failed its integrity check.');
      }
      validateWav(bytes, snapshot);
      if (this.disposed || generation !== this.prepareGeneration) return false;
      // Decoding may resample: all event offsets stay in processed-file seconds.
      // https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData
      const buffer = await this.audioContext().decodeAudioData(bytes);
      if (this.disposed || generation !== this.prepareGeneration) return false;
      if (timedOut) throw new Error('Loading timed out.');
      if (!Number.isFinite(buffer.duration) || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0
        || Math.abs(buffer.duration - snapshot.frameCount / snapshot.sampleRate)
        > Math.max(2 / buffer.sampleRate, 2 / snapshot.sampleRate)) {
        throw new Error('The decoded recording duration does not match its timing data.');
      }
      this.prepared = { record: snapshot, buffer, previewTiming: options.previewTiming === true };
      this.status('ready', this.context?.state === 'running'
        ? 'Recording ready. Tap Hear to listen.' : 'Ready—tap Hear to enable sound.');
      return true;
    } catch (error) {
      if (this.disposed || generation !== this.prepareGeneration) return false;
      this.prepared = null;
      const message = timedOut ? 'Loading timed out. Tap Hear to retry.'
        : `${error instanceof Error ? error.message : 'The recording could not be loaded.'} Tap Hear to retry.`;
      this.status('error', message);
      return false;
    } finally {
      clearTimeout(timeout);
      if (this.pending === abort) this.pending = null;
    }
  }

  playWord(): boolean { return this.play(null); }

  /** Starts at the phone onset and continues naturally through the word's end. */
  playFromPhone(phoneIndex: number): boolean { return this.play(phoneIndex); }

  private play(phoneIndex: number | null): boolean {
    if (this.disposed) return false;
    this.stop();
    const prepared = this.prepared;
    if (!prepared) {
      this.status('error', 'Load the recording before playing it.');
      return false;
    }
    const { record, buffer, previewTiming } = prepared;
    const events = record.events ?? [];
    const timingAllowed = record.review.status === 'reviewed' || previewTiming;
    if (phoneIndex !== null && (!Number.isInteger(phoneIndex) || !events[phoneIndex] || !timingAllowed)) {
      this.status('error', 'Sound timing is unavailable. Enable the candidate timing preview to audition it.');
      return false;
    }
    const context = this.context;
    if (!context || context.state !== 'running') {
      this.status('gesture-required', 'Ready—tap Hear again to enable sound.');
      return false;
    }
    const generation = this.generation;
    let source: AudioBufferSourceNode | null = null;
    let gain: GainNode | null = null;
    try {
      // Buffer sources are one-shot: every intentional playback gets a new node.
      // https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start
      source = context.createBufferSource();
      gain = context.createGain();
      source.buffer = buffer;
      source.loop = false;
      source.connect(gain);
      gain.connect(context.destination);
      const startedAt = context.currentTime;
      const offset = phoneIndex === null ? 0 : events[phoneIndex]!.startFrame / record.sampleRate;
      // https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/linearRampToValueAtTime
      gain.gain.setValueAtTime(0, startedAt);
      gain.gain.linearRampToValueAtTime(1, startedAt + 0.004);
      const playback = { source, gain, generation };
      this.playback = playback;
      source.onended = () => {
        source?.disconnect();
        gain?.disconnect();
        if (this.disposed || generation !== this.generation || this.playback !== playback) return;
        this.playback = null;
        if (this.frame !== null) this.env.cancelFrame(this.frame);
        this.frame = null;
        this.phone(null);
        this.status('ready', 'Recording finished. Tap Hear to listen again.');
      };
      source.start(startedAt, offset);
      this.status('playing', timingAllowed && record.review.status === 'candidate'
        ? 'Playing candidate timing preview; timings are unreviewed.' : 'Playing recording.');
      const render = () => {
        if (this.disposed || generation !== this.generation || this.playback !== playback) return;
        if (context.state !== 'running') {
          this.stop();
          this.status('gesture-required', 'Audio was paused. Tap Hear again to resume listening.');
          return;
        }
        // RAF only renders. Position comes from the audio clock, never RAF's timestamp.
        // https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/currentTime
        const position = (offset + Math.max(0, context.currentTime - startedAt)) * record.sampleRate;
        const event = timingAllowed ? events.find(item => position >= item.startFrame && position < item.endFrame) : undefined;
        this.phone(event?.phoneIndex ?? null);
        if (!this.disposed && generation === this.generation && this.playback === playback) {
          this.frame = this.env.requestFrame(render);
        }
      };
      render();
      return true;
    } catch {
      if (this.playback?.source === source) this.playback = null;
      if (source) { source.onended = null; try { source.stop(); } catch { /* Not started. */ } source.disconnect(); }
      gain?.disconnect();
      this.phone(null);
      this.status('error', 'The recording could not start. Tap Hear to retry.');
      return false;
    }
  }

  /** Stops and invalidates pending work, retaining an already decoded recording. */
  stop(): void {
    this.unlockGeneration++;
    this.stopWork();
  }

  private stopWork(): void {
    this.generation++;
    this.prepareGeneration++;
    this.pending?.abort();
    this.pending = null;
    if (this.frame !== null) this.env.cancelFrame(this.frame);
    this.frame = null;
    const playback = this.playback;
    this.playback = null;
    if (playback) {
      // Immediate cancellation prevents overlap on rapid replacement. The attack
      // ramp softens starts; a delayed stop ramp would leave two voices alive.
      playback.source.onended = null;
      try { playback.source.stop(); } catch { /* Already ended. */ }
      playback.source.disconnect();
      playback.gain.disconnect();
    }
    this.phone(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.prepared = null;
    if (this.context) {
      void this.context.close().catch(() => { /* Browser may have closed it. */ });
      this.context = null;
    }
  }
}
