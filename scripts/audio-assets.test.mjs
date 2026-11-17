import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildDictionary } from './build-dictionary.mjs';

const audioRoot = new URL('../public/audio/', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const load = (name) => readFile(new URL(name, audioRoot));

function pcmInfo(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let format;
  let dataLength;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const type = bytes.toString('ascii', offset, offset + 4);
    assert.ok(offset + 8 + size <= bytes.length, 'WAV chunk lies within file');
    if (type === 'fmt ') {
      format = {
        encoding: bytes.readUInt16LE(offset + 8),
        channels: bytes.readUInt16LE(offset + 10),
        sampleRate: bytes.readUInt32LE(offset + 12),
        blockAlign: bytes.readUInt16LE(offset + 20),
        bits: bytes.readUInt16LE(offset + 22),
      };
    }
    if (type === 'data') dataLength = size;
    offset += 8 + size + (size % 2);
  }
  assert.ok(format && dataLength, 'WAV contains format and nonempty sample data');
  return { ...format, frameCount: dataLength / format.blockAlign };
}

test('four recording assets bind exact WAV samples, provenance, and unreviewed timing candidates', async () => {
  const manifest = JSON.parse(await load('manifest.json'));
  const sources = JSON.parse(await load('sources.json')).sources;
  const dictionary = buildDictionary();
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest.words).sort(), ['dad', 'hello', 'she', 'sheep']);
  for (const [word, recording] of Object.entries(manifest.words)) {
    const bytes = await load(`${word}.wav`);
    const pcm = pcmInfo(bytes);
    assert.equal(recording.word, word);
    const entry = dictionary.words[word];
    const variant = entry.variants.find(candidate => candidate.id === recording.variantId);
    assert.ok(variant?.aligned, `${word}: recording selects a current aligned dictionary variant`);
    assert.equal(recording.variantId, entry.primaryVariantId);
    assert.deepEqual(recording.phones, variant.pronunciation, `${word}: exact stressed pronunciation`);
    const graph = variant.entry ?? entry;
    assert.deepEqual(recording.phones, graph.sounds.map(sound => sound.arpabet));
    assert.deepEqual(recording.graphPhonemes, graph.sounds.map(sound => sound.phoneme));
    assert.equal(recording.audioUrl, `audio/${word}.wav`);
    assert.equal(hash(bytes), recording.sha256, `${word}: timing binds to exact processed asset`);
    assert.equal(pcm.encoding, 1);
    assert.equal(pcm.channels, 1);
    assert.equal(pcm.bits, 16);
    assert.equal(pcm.sampleRate, recording.sampleRate);
    assert.equal(pcm.frameCount, recording.frameCount);
    assert.equal(recording.review.status, 'candidate');
    assert.equal(recording.review.humanReviewed, false);
    assert.equal(recording.review.listeningReviewed, false);
    assert.equal(recording.review.toolVersion, '5.1.1');
    assert.equal(recording.events.length, recording.phones.length);
    let previousEnd = 0;
    for (const [index, event] of recording.events.entries()) {
      assert.equal(event.phoneIndex, index);
      assert.ok(Number.isInteger(event.startFrame) && Number.isInteger(event.endFrame));
      assert.ok(previousEnd <= event.startFrame && event.startFrame < event.endFrame);
      assert.ok(event.endFrame <= recording.frameCount);
      assert.equal(event.sustainStartFrame, undefined);
      assert.equal(event.sustainEndFrame, undefined);
      previousEnd = event.endFrame;
    }
    assert.equal(hash(await load(`originals/${word}.ogg`)), recording.provenance.originalSha256);
    assert.equal(recording.provenance.originalSha256, sources[word].originalSha256);
    assert.ok(Number.isInteger(recording.provenance.sourceRevision));
    assert.ok(recording.provenance.sourceRevisionUrl.includes(`oldid=${recording.provenance.sourceRevision}`));
    assert.equal(recording.provenance.author, 'Dvortygirl');
    assert.equal(recording.provenance.processedLicense, word === 'hello' ? 'Public domain' : 'CC BY-SA 3.0');
  }
  const license = await load('CC-BY-SA-3.0.txt');
  assert.match(license.toString(), /Attribution-ShareAlike 3.0 Unported/);
});

test('audio build lock references public package infrastructure only', async () => {
  const lock = await readFile(new URL('./prepare-audio.py.lock', import.meta.url), 'utf8');
  const hosts = [...lock.matchAll(/https:\/\/([^/" ]+)/g)].map(match => match[1]);
  assert.ok(hosts.length > 0);
  assert.ok(hosts.every(host => ['pypi.org', 'files.pythonhosted.org'].includes(host)));
});
