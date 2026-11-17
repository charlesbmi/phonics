import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Lexicon, hasLetterGroups, shardKey } from './lexicon.ts';

function fixture({ failOnce = false, corrupt = false } = {}) {
  const body = JSON.stringify({ hello: { groups: [{ text: 'hello', phoneme: 'test', cue: null, vowel: null }] } });
  const manifest = { schemaVersion: 1, counts: { total: 1, complete: 1, pronunciationOnly: 0 }, shards: { he: { path: 'lexicon/shards/he.json', sha256: createHash('sha256').update(body).digest('hex'), words: 1 } } };
  const requests = [];
  let failed = false;
  const fetcher = async url => {
    requests.push(url.pathname);
    if (url.pathname.endsWith('manifest.json')) return Response.json(manifest);
    if (failOnce && !failed) { failed = true; return new Response('', { status: 503 }); }
    return new Response(corrupt ? '{}' : body);
  };
  return { fetcher, lexicon: new Lexicon(new URL('https://example.com/phonics/'), fetcher), requests };
}

test('lookup loads only needed shards, deduplicates concurrent requests, and caches misses', async () => {
  const { lexicon, requests } = fixture();
  await Promise.all([lexicon.loadWords(['Hello', 'hello']), lexicon.loadWords(['hello'])]);
  assert.deepEqual(requests, ['/phonics/lexicon/manifest.json', '/phonics/lexicon/shards/he.json']);
  assert.ok(hasLetterGroups(lexicon.lookup('HELLO')));
  assert.equal(lexicon.lookup('her'), undefined);
  assert.equal(lexicon.needsWords(['hello', 'her', 'zzzz']), false);
  await lexicon.loadWords(['her', 'zzzz']);
  assert.equal(requests.length, 2);
  assert.equal(lexicon.lookup('constructor'), undefined);
});

test('failed loads can retry and corrupted dictionary data is rejected', async () => {
  const { lexicon, requests } = fixture({ failOnce: true });
  await assert.rejects(lexicon.loadWords(['hello']), /unavailable/);
  assert.equal(lexicon.needsWords(['hello']), true);
  await lexicon.loadWords(['hello']);
  assert.ok(lexicon.lookup('hello'));
  assert.equal(requests.filter(path => path.endsWith('manifest.json')).length, 2, 'retry refreshes stale manifest');
  const bad = fixture({ corrupt: true });
  await assert.rejects(bad.lexicon.loadWords(['hello']), /checksum/);
  assert.equal(bad.lexicon.lookup('hello'), undefined);
});

test('word normalization handles apostrophes without treating inherited properties as entries', () => {
  assert.equal(shardKey('Hello'), 'he');
  assert.equal(shardKey('a'), 'a');
  assert.equal(shardKey('A’s'), 'a_');
  assert.equal(hasLetterGroups({ pronunciation: ['K', 'EY1', 'K'], reason: 'unresolved-alignment' }), false);
});

test('default loader preserves the browser fetch receiver', async () => {
  const original = globalThis.fetch;
  const { fetcher } = fixture();
  globalThis.fetch = function (...args) {
    assert.equal(this, globalThis);
    return fetcher(...args);
  };
  try {
    const lexicon = new Lexicon(new URL('https://example.com/phonics/'));
    await lexicon.loadWords(['hello']);
    assert.ok(lexicon.lookup('hello'));
  } finally { globalThis.fetch = original; }
});
