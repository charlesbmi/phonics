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

Source pins, checksums and licenses live in `data/`. Unknown words receive no guessed hints. The importer processes the complete pinned dictionaries automatically; there is no selected-word list. It emits prefix shards, loading only the prefixes needed for the text. Alignments that fail agreement or ownership checks remain pronunciation-only.

```sh
bin/npm run data:build
bin/npm run data:check
bin/npm run generate:sentences
bin/npm run evaluate:sentences
```

`data:refresh` restores the full pinned sources; changing source versions requires updating their checksums deliberately. See [Sources](sources.md) for the annotation rules.

## Deploy

Pushes to `main` run checks and deploy `dist/` to GitHub Pages. Pull requests run checks without deploying. The workflow supplies `/phonics/` as the build base path.

Future sound-level playback needs reviewed recordings and phoneme timestamps. Browser speech currently provides whole-word audio only.

The [alignment guide](alignment-next.md) covers the implemented graph importer and remaining work. The [gradual-reading plan](gradual-reading.md) scopes reviewed audio and timed highlighting.

To regenerate the vendored NRC conversion graph, install uv and run `bin/npm run data:preprocess`. This optional refresh uses Python; normal tests and builds use only Node and checked-in data.

Run `bin/npm run evaluate:common` for the sourced 500-word reader audit; add `-- --check` to verify saved results.
