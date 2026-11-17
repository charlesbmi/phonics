import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AudioController } from './audio-controller.ts';

function wav() {
  const bytes = new ArrayBuffer(2044);
  const view = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 2036, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 1000, true); view.setUint32(28, 2000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, 2000, true);
  return bytes;
}
const bytes = wav();
const hash = value => createHash('sha256').update(new Uint8Array(value)).digest('hex');
const record = {
  word: 'dad', variantId: 'dad:D-AE1-D', phones: ['D', 'AE1', 'D'], audioUrl: 'audio/dad.wav',
  sha256: hash(bytes), sampleRate: 1000, frameCount: 1000,
  events: [{ phoneIndex: 0, startFrame: 100, endFrame: 300 },
    { phoneIndex: 1, startFrame: 400, endFrame: 600 },
    { phoneIndex: 2, startFrame: 650, endFrame: 900 }],
  review: { status: 'reviewed' },
};
const expected = { variantId: record.variantId, phones: record.phones };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = () => ({ ok: true, arrayBuffer: async () => bytes.slice(0) });

function fixture(overrides = {}) {
  const phones = [], statuses = [], sources = [], fetches = [], frames = new Map();
  let nextFrame = 1, contexts = 0;
  const context = {
    state: 'suspended', currentTime: 10, sampleRate: 48000, destination: {}, resumes: 0, decodes: 0, closed: 0,
    async resume() { this.resumes++; this.state = 'running'; },
    async close() { this.closed++; this.state = 'closed'; },
    async decodeAudioData() { this.decodes++; return { duration: 1, sampleRate: 48000 }; },
    createBufferSource() {
      const source = {
        buffer: null, loop: true, onended: null, starts: [], stops: 0, disconnected: false,
        connect() {}, disconnect() { this.disconnected = true; },
        start(...args) { this.starts.push(args); }, stop() { this.stops++; },
      };
      sources.push(source);
      return source;
    },
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; },
  };
  const controller = new AudioController({ baseUrl: new URL('https://example.test/reader/'),
    onPhone: phone => phones.push(phone), onStatus: (state, message) => statuses.push({ state, message }) }, {
    createContext: () => { contexts++; return context; },
    fetch: async (url, options) => { fetches.push({ url: String(url), signal: options.signal }); return response(); },
    sha256: async value => hash(value),
    requestFrame: callback => { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelFrame: id => frames.delete(id), ...overrides,
  });
  return { controller, context, phones, statuses, sources, fetches, frames,
    contexts: () => contexts,
    tick(audioTime, rafTime = 0) { context.currentTime = audioTime; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(rafTime)); },
  };
}

test('preparation stays silent, verifies bytes, resolves base path, and accepts browser resampling', async () => {
  const f = fixture();
  assert.equal(await f.controller.prepare(record, expected), true);
  assert.equal(f.context.resumes, 0);
  assert.equal(f.sources.length, 0);
  assert.equal(f.context.decodes, 1);
  assert.equal(f.fetches[0].url, 'https://example.test/reader/audio/dad.wav');
  assert.deepEqual(f.phones, []);
  assert.equal(f.controller.playWord(), false);
  assert.equal(f.statuses.at(-1).state, 'gesture-required');
  assert.equal(await f.controller.unlock(), true);
  assert.equal(f.controller.playWord(), true);
  assert.deepEqual(f.sources[0].starts, [[10, 0]]);
  assert.equal(f.sources[0].loop, false);
  f.controller.dispose();
});

test('phone rendering follows the audio clock, includes silence gaps, and ignores RAF wall time', async () => {
  const f = fixture();
  await f.controller.unlock(); await f.controller.prepare(record, expected); f.controller.playWord();
  f.tick(10.11, 900000); assert.deepEqual(f.phones, [0]);
  f.tick(10.11, 999999); assert.deepEqual(f.phones, [0]);
  f.tick(10.35, 1000000); assert.equal(f.phones.at(-1), null);
  f.tick(10.45); assert.equal(f.phones.at(-1), 1);
  f.tick(10.7); assert.equal(f.phones.at(-1), 2);
  f.sources[0].onended();
  assert.equal(f.phones.at(-1), null);
  assert.equal(f.frames.size, 0);
  assert.equal(f.statuses.at(-1).state, 'ready');
  f.controller.dispose();
});

test('sound-onset playback converts processed-file frames to seconds after decode resampling', async () => {
  const f = fixture();
  await f.controller.unlock(); await f.controller.prepare(record, expected);
  assert.equal(f.controller.playFromPhone(1), true);
  assert.deepEqual(f.sources[0].starts, [[10, 0.4]]);
  assert.deepEqual(f.phones, [1]);
  f.tick(10.26); assert.equal(f.phones.at(-1), 2);
  f.controller.dispose();
});

test('rapid taps replace one-shot sources and stale ended/render callbacks cannot clear a new session', async () => {
  const f = fixture();
  await f.controller.unlock(); await f.controller.prepare(record, expected); f.controller.playFromPhone(0);
  const oldEnded = f.sources[0].onended;
  const oldRender = [...f.frames.values()][0];
  f.controller.playFromPhone(1);
  assert.equal(f.sources[0].stops, 1); assert.equal(f.sources[0].disconnected, true);
  assert.equal(f.sources.length, 2); assert.equal(f.phones.at(-1), 1);
  oldEnded(); oldRender(999999);
  assert.equal(f.phones.at(-1), 1); assert.equal(f.frames.size, 1);
  f.controller.stop();
  assert.equal(f.sources[1].stops, 1); assert.equal(f.frames.size, 0); assert.equal(f.phones.at(-1), null);
  assert.equal(f.controller.playWord(), true, 'stop retains the decoded recording');
  assert.equal(f.context.decodes, 1);
  f.controller.dispose();
});

test('candidate recordings play whole words without timings until preview is explicitly opted in', async () => {
  const f = fixture();
  const candidate = { ...record, review: { status: 'candidate' } };
  await f.controller.unlock(); await f.controller.prepare(candidate, expected); f.controller.playWord();
  f.tick(10.45); assert.deepEqual(f.phones, []);
  assert.equal(f.controller.playFromPhone(1), false);
  assert.equal(await f.controller.prepare(candidate, expected, { previewTiming: true }), true);
  assert.equal(f.fetches.length, 1, 'preview changes reuse the verified buffer');
  assert.equal(f.controller.playFromPhone(1), true);
  assert.equal(f.phones.at(-1), 1); assert.match(f.statuses.at(-1).message, /unreviewed/);
  await f.controller.prepare(candidate, expected);
  assert.equal(f.controller.playFromPhone(1), false, 'opt-in is not inherited by the next prepare');
  await f.controller.prepare({ ...candidate, events: [] }, expected, { previewTiming: true });
  assert.equal(f.controller.playWord(), true);
  assert.equal(f.controller.playFromPhone(0), false);
  f.controller.dispose();
});

test('wrong variant, exact phone mismatch, bad interval ordering and out-of-bounds frames fail before fetch', async () => {
  for (const invalid of [
    { ...record, variantId: 'other' }, { ...record, phones: ['D', 'AE0', 'D'] },
    { ...record, events: [{ phoneIndex: 0, startFrame: 100, endFrame: 300 }] },
    { ...record, events: record.events.map((event, i) => i === 1 ? { ...event, startFrame: 200 } : event) },
    { ...record, events: record.events.map((event, i) => i === 2 ? { ...event, endFrame: 1001 } : event) },
    { ...record, events: record.events.map((event, i) => i === 1 ? { ...event, startFrame: 400.5 } : event) },
    { ...record, events: [] },
  ]) {
    const f = fixture();
    assert.equal(await f.controller.prepare(invalid, expected), false);
    assert.equal(f.fetches.length, 0); assert.equal(f.statuses.at(-1).state, 'error');
    f.controller.dispose();
  }
});

test('hash mismatch and original WAV frame mismatch are rejected before decoding', async () => {
  for (const invalid of [{ ...record, sha256: 'f'.repeat(64) }, { ...record, sampleRate: 2000 }, { ...record, frameCount: 1001 }]) {
    const f = fixture();
    assert.equal(await f.controller.prepare(invalid, expected), false);
    assert.equal(f.context.decodes, 0); assert.equal(f.controller.playWord(), false);
    f.controller.dispose();
  }
});

test('stop aborts an in-flight fetch and a late success never creates a context or revives playback', async () => {
  const pending = deferred(); let signal;
  const f = fixture({ fetch: (_url, options) => { signal = options.signal; return pending.promise; } });
  const preparing = f.controller.prepare(record, expected);
  f.controller.stop(); assert.equal(signal.aborted, true);
  pending.resolve(response()); assert.equal(await preparing, false);
  assert.equal(f.contexts(), 0); assert.equal(f.sources.length, 0);
  assert.equal(f.statuses.filter(status => status.state === 'ready').length, 0);
  f.controller.dispose();
});

test('a newer selection wins even when the old non-abortable decode resolves last', async () => {
  const pending = deferred(); const f = fixture();
  let decodes = 0;
  f.context.decodeAudioData = () => ++decodes === 1 ? pending.promise : Promise.resolve({ duration: 1, sampleRate: 48000 });
  const old = f.controller.prepare(record, expected);
  while (!decodes) await new Promise(resolve => setImmediate(resolve));
  const nextRecord = { ...record, audioUrl: 'audio/second.wav', word: 'second' };
  assert.equal(await f.controller.prepare(nextRecord, expected), true);
  pending.resolve({ duration: 1, sampleRate: 48000 }); assert.equal(await old, false);
  assert.equal(await f.controller.prepare(nextRecord, expected), true);
  assert.equal(f.fetches.length, 2, 'late old decode did not replace the new verified buffer');
  f.controller.dispose();
});

test('retry after network failure succeeds without resuming outside an intentional gesture', async () => {
  let calls = 0;
  const f = fixture({ fetch: async () => { if (++calls === 1) throw new Error('Network unavailable.'); return response(); } });
  assert.equal(await f.controller.prepare(record, expected), false);
  assert.match(f.statuses.at(-1).message, /retry/);
  assert.equal(await f.controller.prepare(record, expected), true);
  assert.equal(f.context.resumes, 0);
  f.controller.dispose();
});

test('gesture resume rejection or continued suspension reports actionable status and starts no source', async () => {
  for (const resume of [async () => { throw new Error('NotAllowedError'); }, async () => {}]) {
    const f = fixture(); f.context.resume = resume;
    await f.controller.prepare(record, expected);
    assert.equal(await f.controller.unlock(), false);
    assert.equal(f.statuses.at(-1).state, 'gesture-required');
    assert.match(f.statuses.at(-1).message, /Tap Hear/);
    assert.equal(f.controller.playWord(), false); assert.equal(f.sources.length, 0);
    f.controller.dispose();
  }
});

test('unlock requested before preparation preserves the gesture while loading and suspension stops running playback', async () => {
  const f = fixture();
  const unlocking = f.controller.unlock();
  assert.equal(await f.controller.prepare(record, expected), true);
  assert.equal(await unlocking, true);
  assert.equal(f.controller.playWord(), true);
  f.context.state = 'suspended'; f.tick(10.2);
  assert.equal(f.sources[0].stops, 1); assert.equal(f.frames.size, 0);
  assert.equal(f.statuses.at(-1).state, 'gesture-required');
  f.controller.dispose();
});

test('dispose closes the context, clears markers and prevents future work', async () => {
  const f = fixture();
  await f.controller.unlock(); await f.controller.prepare(record, expected); f.controller.playFromPhone(1);
  const ended = f.sources[0].onended;
  f.controller.dispose(); const count = f.statuses.length; ended();
  assert.equal(f.phones.at(-1), null); assert.equal(f.context.closed, 1); assert.equal(f.frames.size, 0);
  assert.equal(await f.controller.unlock(), false); assert.equal(await f.controller.prepare(record, expected), false);
  assert.equal(f.controller.playWord(), false); assert.equal(f.statuses.length, count);
  f.controller.dispose(); assert.equal(f.context.closed, 1);
});


test('stop suppresses a late unlock rejection without reviving a canceled status', async () => {
  const pending = deferred(); const f = fixture();
  f.context.resume = () => pending.promise;
  const unlocking = f.controller.unlock();
  f.controller.stop(); const count = f.statuses.length;
  pending.reject(new Error('NotAllowedError'));
  assert.equal(await unlocking, false);
  assert.equal(f.statuses.length, count);
  assert.equal(f.sources.length, 0);
  f.controller.dispose();
});
