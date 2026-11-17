import { readFileSync, writeFileSync } from 'node:fs';
import { sha256 } from './build-dictionary.mjs';

const root = new URL('../', import.meta.url);
const lock = JSON.parse(readFileSync(new URL('data/sources.lock.json', root), 'utf8'));
const files = { cmudict: 'cmudict.dict', alignment: 'nrc-aligned.txt', phoneClasses: 'cmudict.phones' };
// Verify all downloads before replacing any pinned inputs. Never depend on a curated word list.
const downloads = await Promise.all(Object.entries(files).map(async ([key, file]) => {
  const source = lock[key];
  const repo = source.repository.replace('https://github.com/', '');
  const url = `https://raw.githubusercontent.com/${repo}/${source.revision}/${source.path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${url}: ${response.status}`);
  const full = await response.text();
  if (sha256(full) !== source.sha256) throw new Error(`Upstream checksum differs: ${key}`);
  return { file, full, key };
}));
for (const { file, full, key } of downloads) {
  writeFileSync(new URL(`data/upstream/${file}`, root), full);
  console.log(`Restored full pinned ${key} source.`);
}
