import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const sha256 = value => createHash('sha256').update(value).digest('hex');

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
// The converter is official NRC code, pinned by git revision plus uv's script lock.
// Python and network access belong to source refresh only, never normal builds.
let result;
for (const executable of ['uv', '/opt/homebrew/bin/uv', `${process.env.HOME}/.local/bin/uv`]) {
  result = spawnSync(executable, ['run', '--locked', '--no-config', 'scripts/preprocess-alignments.py'], { cwd: fileURLToPath(root), stdio: 'inherit' });
  if (result.error?.code !== 'ENOENT') break;
}
if (result.error || result.status !== 0) throw new Error('Pinned NRC preprocessing failed; install uv, then rerun npm run data:refresh.');
if (sha256(readFileSync(new URL('data/upstream/nrc-ipa-graphs.json', root))) !== lock.ipaConversion.sha256) throw new Error('Generated NRC conversion differs from its pinned checksum');
