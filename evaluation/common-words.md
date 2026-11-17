# Common-word reader audit

500 independently selected frequency words. Baseline: 221 mapped, 279 pronunciation-only, 0 missing, 161 with complete teaching cues. Current: **463 mapped**, **37 pronunciation-only**, **0 missing**; **387/500** have complete teaching cues.

Source: [wordfreq English large list](https://raw.githubusercontent.com/rspeer/wordfreq/master/wordfreq/data/large_en.msgpack.gz), SHA-256 `dffae8066b78dce0a6667cf5f58e567054f902674667090a7ac8a8a44628b05c`. First 500 tokens matching `^[a-z]+(?:'[a-z]+)*$`, in source frequency-bin order (ties retain upstream alphabetical order). Excludes numbers and punctuation; retains internal-apostrophe contractions. This general-language sample is not a child-reading curriculum.

Frequency data © Robyn Speer, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); extraction/filtering is a modification. wordfreq © Robyn Speer; includes Google Books Ngrams (https://books.google.com/ngrams), the Leeds Internet Corpus, Wikipedia, ParaCrawl, OPUS OpenSubtitles 2018 (OpenSubtitles.org), and freely available SUBTLEX data by Marc Brysbaert et al. (http://crr.ugent.be/programs-data/subtitle-frequencies). See upstream NOTICE.md for complete terms and citations.

Reproduce: `node scripts/evaluate-common-words.mjs`; check saved report: add `--check`. To verify selection against the original downloaded gzip, add `--verify-frequency-source /path/to/large_en.msgpack.gz` (checksum enforced).

“Mapped” checks spelling reconstruction and source pronunciation agreement. It does not prove that each source alignment is a good teaching choice. “Complete teaching cues” only measures documented quick/stretch coverage, separately from pronunciation.

Remaining pronunciation-only/missing words: one (unresolved-alignment), people (alignment-review), our (alignment-review), work (alignment-review), world (alignment-review), s (unresolved-alignment), around (alignment-review), little (alignment-review), each (alignment-review), mr (unresolved-alignment), didn't (alignment-review), few (alignment-review), doesn't (alignment-review), once (unresolved-alignment), everyone (unresolved-alignment), d (unresolved-alignment), working (alignment-review), able (alignment-review), early (alignment-review), information (alignment-review), t (unresolved-alignment), isn't (alignment-review), often (alignment-review), single (alignment-review), hours (alignment-review), history (alignment-review), m (unresolved-alignment), research (alignment-review), anyone (unresolved-alignment), possible (alignment-review), b (unresolved-alignment), question (alignment-review), r (alignment-review), c (unresolved-alignment), future (alignment-review), fire (alignment-review), major (alignment-review).

Unclassified phones in mapped sample: ER0, NG, TH. These retain an explicit unknown teaching cue. hello /ə/ now uses UFLI’s documented quick schwa convention; ER0 is not covered by that supplement.

Known heteronyms in this sample: read, live, does, close, use, house, second. Primary CMU pronunciation remains context-free.

| Edge case | Status | Selected pronunciation | Why checked |
| --- | --- | --- | --- |
| hello | mapped | HH AH0 L OW1 | AH0 schwa should have sourced quick cue, not inherited stressed AH stretch. |
| e | mapped | IY1 | Letter name IY1 is stretch; spelling alone does not identify schwa. |
| x | pronunciation-only | EH1 K S | Letter-name pronunciation needs an alignment; it is not the /ks/ sound of x in box. |
| box | mapped | B AA1 K S | The x group must retain two independently cued phones K quick and S stretch. |
| make | mapped | M EY1 K | Final silent e participates in the reviewed generic split-digraph pattern. |
| you | mapped | Y UW1 | Y+UW multi-phone alignment must retain both phones. |
| apple | pronunciation-only | AE1 P AH0 L | Risky upstream vowel-to-p assignment is withheld, not silently repaired. |
| little | pronunciation-only | L IH1 T AH0 L | Risky source vowel-to-consonant assignment requires review. |
| bottle | pronunciation-only | B AA1 T AH0 L | Risky source vowel-to-consonant assignment requires review. |
| read | mapped | R EH1 D | Heteronym: context-free primary pronunciation cannot choose tense. |
| the | mapped | DH AH0 | Primary and reduced/dialect alternatives are not contextually selected. |
| of | mapped | AH1 V | Irregular spelling must follow source pronunciation. |
| one | pronunciation-only | W AH1 N | Irregular spelling alignment must retain source phone order. |
| said | mapped | S EH1 D | Vowel team is not automatically long. |
| day | mapped | D EY1 | One EY phoneme crosses the raw a/y source boundary. |
| wait | mapped | W EY1 T | One EY phoneme crosses the raw a/i source boundary. |
| each | pronunciation-only | IY1 CH | Source a participates in CH; questionable ownership remains withheld. |
| amplifier | pronunciation-only | AE1 M P L AH0 F AY2 ER0 | Conflicting ie and er teaching units must not both claim the same silent span. |

Per-word results, source ranks, cue gaps and numbered CMU alternatives are recorded in [common-words-report.json](common-words-report.json). The baseline records the previous importer and cue policy, so its cue gain includes the explicit schwa policy change as well as importer coverage. No educational efficacy claim follows from this audit.
