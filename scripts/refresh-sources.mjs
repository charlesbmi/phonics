import { readFileSync, writeFileSync } from 'node:fs';
import { sha256, parseAlignment } from './build-dictionary.mjs';

const root = new URL('../', import.meta.url);
const lock = JSON.parse(readFileSync(new URL('data/sources.lock.json', root), 'utf8'));
const words = new Set(JSON.parse(readFileSync(new URL('data/words.json', root), 'utf8')));
const files = { cmudict: 'cmudict.dict', alignment: 'nrc-aligned.txt', phoneClasses: 'cmudict.phones' };
for (const [key, source] of Object.entries(lock)) {
  const repo = source.repository.replace('https://github.com/', '');
  const url = `https://raw.githubusercontent.com/${repo}/${source.revision}/${source.path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${url}: ${response.status}`);
  const full = await response.text();
  if (sha256(full) !== source.sha256) throw new Error(`Upstream checksum differs: ${key}`);
  const subset = key === 'phoneClasses' ? full : full.split('\n').filter(line => {
    if (!line) return false;
    const word = key === 'cmudict' ? line.split(' ')[0] : parseAlignment(line).map(part => part.text).join('');
    return words.has(word);
  }).join('\n') + '\n';
  if (sha256(subset) !== source.subsetSha256) throw new Error(`Source subset differs: ${key}`);
  writeFileSync(new URL(`data/upstream/${files[key]}`, root), subset);
  console.log(`Restored pinned ${key} source.`);
}
