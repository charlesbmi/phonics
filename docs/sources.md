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

- Generation checks spelling coverage, phone order, source hashes, and explicit cue entries. Unresolved alignments fail generation; unknown words stay unmarked.
- Four reviewed merges join `ee` in see/sheep, `oa` in boat, and `ch` in chip. They preserve the source phonemes.
- Quick/stretch follows NIFDI’s convention, including quick `h`. Other teaching systems can differ. These are teaching cues, not measured sound durations; a short vowel can have a stretch cue.
- AH0, ER0, NG, TH and ZH have no supported cue in this table. These sounds show ? in the sound guide; documented sounds keep their quick/stretch marks. Currently this affects a, hello and the.
- Long-vowel marks identify conventional letter-name sounds. They do not mean “hold longer.” Split digraphs and multi-phone long u need further grouping support.
- Browser speech may use a different pronunciation variant. Its audio is not aligned to the visual guide.

The app’s shapes and colors present these annotations; no third-party app graphics or audio are bundled. Dictionary notices are retained in `data/upstream/` and [the shipped credits](../public/third-party-licenses.txt).
