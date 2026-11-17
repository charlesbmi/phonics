import type { WordEntry } from './model';

export interface PronunciationEntry {
  pronunciation: string[];
  reason: 'missing-alignment' | 'unresolved-alignment';
}
export type LexiconEntry = WordEntry | PronunciationEntry;
interface ShardInfo { path: string; sha256: string; words: number }
export interface LexiconManifest {
  schemaVersion: number;
  counts: { total: number; complete: number; pronunciationOnly: number };
  shards: Record<string, ShardInfo>;
}
export const normalizeWord = (word: string): string => word.normalize('NFC').toLowerCase().replaceAll('’', "'");
export const shardKey = (word: string): string => normalizeWord(word).slice(0, 2).replace(/[^a-z]/g, '_');
export const hasLetterGroups = (entry: LexiconEntry | undefined): entry is WordEntry => !!entry && 'groups' in entry;

// Shards are cached by prefix and checked against the build manifest before use.
export class Lexicon {
  private base: URL;
  private fetcher: typeof fetch;
  private manifest?: LexiconManifest;
  private manifestRequest?: Promise<LexiconManifest>;
  private shards = new Map<string, Record<string, LexiconEntry>>();
  private pending = new Map<string, Promise<void>>();

  constructor(base: URL, fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)) {
    this.base = base;
    this.fetcher = fetcher;
  }
  lookup(word: string): LexiconEntry | undefined {
    const data = this.shards.get(shardKey(word));
    const key = normalizeWord(word);
    return data && Object.hasOwn(data, key) ? data[key] : undefined;
  }
  needsWords(words: string[]): boolean {
    if (!words.length) return false;
    if (!this.manifest) return true;
    return words.some(word => Object.hasOwn(this.manifest!.shards, shardKey(word)) && !this.shards.has(shardKey(word)));
  }
  async loadWords(words: string[]): Promise<void> {
    if (!words.length) return;
    const manifest = await this.loadManifest();
    try {
      await Promise.all([...new Set(words.map(shardKey))].map(key => {
        if (!Object.hasOwn(manifest.shards, key) || this.shards.has(key)) return;
        const existing = this.pending.get(key);
        if (existing) return existing;
        const request = this.loadShard(key, manifest.shards[key], manifest).finally(() => { if (this.pending.get(key) === request) this.pending.delete(key); });
        this.pending.set(key, request);
        return request;
      }));
    } catch (error) {
      // Retry must fetch a fresh manifest after a deployment or a failed shard.
      if (this.manifest === manifest) {
        this.manifest = undefined;
        this.shards.clear();
        this.pending.clear();
      }
      throw error;
    }
  }
  private async loadManifest(): Promise<LexiconManifest> {
    if (this.manifest) return this.manifest;
    if (!this.manifestRequest) {
      this.manifestRequest = (async () => {
        const response = await this.fetcher(new URL('lexicon/manifest.json', this.base), { cache: 'no-cache' });
        if (!response.ok) throw Error('Dictionary manifest unavailable');
        const manifest: LexiconManifest = await response.json();
        if (manifest.schemaVersion !== 1 || !manifest.shards || !manifest.counts) throw Error('Unsupported dictionary manifest');
        this.manifest = manifest;
        return manifest;
      })().finally(() => { this.manifestRequest = undefined; });
    }
    return this.manifestRequest;
  }
  private async loadShard(key: string, info: ShardInfo, manifest: LexiconManifest): Promise<void> {
    const url = new URL(info.path, this.base);
    if (url.origin !== this.base.origin || !url.pathname.startsWith(this.base.pathname)) throw Error('Invalid dictionary path');
    const response = await this.fetcher(url, { cache: 'no-cache' });
    if (!response.ok) throw Error('Dictionary shard unavailable');
    const text = await response.text();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== info.sha256) throw Error('Dictionary checksum mismatch');
    const entries: Record<string, LexiconEntry> = JSON.parse(text);
    if (Object.keys(entries).length !== info.words) throw Error('Dictionary entry count mismatch');
    if (this.manifest === manifest) this.shards.set(key, entries);
  }
}
