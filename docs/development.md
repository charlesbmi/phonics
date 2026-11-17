# Development

A static TypeScript + Vite app. Node is pinned with [Hermit](https://cashapp.github.io/hermit/).

```sh
bin/npm ci
bin/npm run dev
```

Open the address printed by Vite. For a production preview, run `bin/npm run build`, then `bin/npm run preview`.

## Checks

```sh
bin/npm test
bin/npm run evaluate:sentences -- --check
bin/npm run build
```

The 100 sentence cases check annotation coverage and rendering assumptions; they do not validate teaching effectiveness. Review them in [the generated table](../evaluation/sentences.md).

## Dictionary

Source pins, checksums and licenses live in `data/`. Unknown words receive no guessed hints. To add vocabulary, update `data/words.json`, the pinned source subsets and their checksums, then review the alignments and teaching groups.

```sh
bin/npm run data:build
bin/npm run data:check
bin/npm run generate:sentences
bin/npm run evaluate:sentences
```

`data:refresh` fetches the existing pinned subset; it does not add words automatically. See [Sources](sources.md) for the annotation rules.

## Deploy

Pushes to `main` run checks and deploy `dist/` to GitHub Pages. Pull requests run checks without deploying. The workflow supplies `/phonics/` as the build base path.

Future sound-level playback needs reviewed recordings and phoneme timestamps. Browser speech currently provides whole-word audio only.
