# Data sources

Pronunciation and letter alignment come from pinned dictionaries. Teaching hints are a separate, documented convention.

| Data | Source |
| --- | --- |
| US pronunciation and phone classes | [CMUdict](https://github.com/cmusphinx/cmudict) |
| Letter-to-sound alignment | [NRC g2p aligned lexicon](https://github.com/NRC-ILT/g2p) |
| Quick/stretch convention | [NIFDI sound-pronunciation packet](https://www.nifdi.org/videos/video-guides/di-and-science-of-reading-webinar/4134-corrective-reading-decoding-a-b1-b2-and-c-sound-pronunciation-packet/file.html) |
| Conventional vowel names and spelling examples | [Hooked on Phonics chart](https://www.hookedonphonics.com/wp-content/uploads/2025/05/44-phonemes-chart-rev2.pdf) |

[Source pins and checksums](../data/sources.lock.json), [per-phone cue evidence](../data/policies/sound-cues.json), and [letter-group adjustments](../data/policies/teaching-groups.json) contain the detailed provenance. Source citations do not imply endorsement.

## Annotation rules

- The full pinned dictionaries are imported automatically. Current coverage is recorded in the [generated manifest](../public/lexicon/manifest.json); there is no maintained vocabulary list.
- NRC's library converts whole IPA sequences and preserves graph links. Source-empty spelling spans remain separate; sound steps follow phonemes rather than letter count.
- General chart patterns supply teaching units, including contiguous teams and split vowels. Raw source links remain available separately; no word-specific grouping overrides are used.
- Quick/stretch follows NIFDI, with an explicit [UFLI schwa supplement](https://ufli.education.ufl.edu/resources/teaching-resources/glossary/). UFLI calls schwa quick, so AH0 in hello has a quick cue. ER0, NG, TH and ZH remain unspecified by this policy; a missing cue is not an uncertain pronunciation or a silent letter.
- Long-vowel marks identify conventional letter-name sounds, not a longer measured duration.
- Questionable ownership and unresolved variants stay unmarked. Parents can choose available dictionary pronunciations; the app does not infer meaning or tense from a sentence.
- Browser speech is separate from the selected dictionary variant and is not aligned to the visual guide.

The app’s shapes and colors present these annotations; no third-party app graphics or audio are bundled. Dictionary notices are retained in `data/upstream/` and [the shipped credits](../public/third-party-licenses.txt).

The [alignment implementation and next steps](alignment-next.md) describe the library pipeline, validation limits and remaining work.

Nine self-hosted reading fonts include single- and double-storey a, different l/t shapes, and two monospace options. Their [licenses and provenance](../public/fonts/README.txt) are bundled with the site.
