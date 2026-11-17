# /// script
# requires-python = ">=3.11"
# dependencies = ["g2p @ git+https://github.com/NRC-ILT/g2p@ada77007168481de7422c6a44d6bc3df1ad95f4e"]
# [[tool.uv.index]]
# name = "pypi"
# url = "https://pypi.org/simple"
# default = true
# ///
"""Refresh whole-word NRC IPA graphs; ordinary Node builds never execute Python.

uv run --locked scripts/preprocess-alignments.py [--check]
Convert each unique complete IPA pronunciation, because multi-character NRC rules
can cross source-segment boundaries (day's e + ɪ is one EY). Extract each complete
ARPAbet token's input-character set from the library graph, never by subdividing
ARPAbet substring alignments. Node maps those IPA indices to the original raw
spelling segments. Preserve raw epsilon separately: NRC's eng -> eng-ipa graph
attaches deleted letters to adjacent outputs and cannot recover silent spans.
API: https://github.com/NRC-ILT/g2p/blob/ada77007168481de7422c6a44d6bc3df1ad95f4e/g2p/__init__.py#L42-L78
Graph: https://github.com/NRC-ILT/g2p/blob/ada77007168481de7422c6a44d6bc3df1ad95f4e/g2p/transducer/__init__.py#L214-L254
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time

import g2p
from g2p import make_g2p

REVISION = "ada77007168481de7422c6a44d6bc3df1ad95f4e"
ROOT = Path(__file__).resolve().parent.parent


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def token_graph(converter, ipa):
    """Return [ARPAbet token, original IPA character indices] pairs, or null."""
    graph = converter(ipa)
    tokens = list(re.finditer(r"\S+", graph.output_string))
    if any(not re.fullmatch(r"[A-Z]+", token.group()) for token in tokens):
        return None
    output_to_token = {index: number for number, token in enumerate(tokens) for index in range(token.start(), token.end())}
    inputs = [set() for _ in tokens]
    for source, target in graph.alignments():
        if target in output_to_token:
            if not 0 <= source < len(ipa):
                raise ValueError(f"Invalid library input index: {ipa!r}: {source}")
            inputs[output_to_token[target]].add(source)
    if any(not indices for indices in inputs):
        return None
    # Never silently lose a source IPA character while extracting token links.
    covered = set().union(*inputs) if inputs else set()
    if covered != set(range(len(ipa))):
        return None
    return [[token.group(), sorted(indices)] for token, indices in zip(tokens, inputs)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--benchmark", type=int, metavar="N", help="Time N whole-word conversions without writing data")
    args = parser.parse_args()
    source = (ROOT / "data/upstream/nrc-aligned.txt").read_bytes()
    lock = json.loads((ROOT / "data/sources.lock.json").read_text())
    if sha256(source) != lock["alignment"]["sha256"]:
        raise ValueError("Pinned NRC alignment checksum mismatch")
    library = Path(g2p.__file__).resolve().parent
    rules_path = library / "mappings/langs/eng/eng_ipa_to_arpabet.json"
    converter = make_g2p("eng-ipa", "eng-arpabet", tokenize=False, neural=False)
    pronunciations = {""}
    for line in source.decode().splitlines():
        pronunciations.add("".join(pair.split("}")[1].replace("|", "").replace("_", "") for pair in line.split()))
    conversions = {}
    started = time.monotonic()
    ordered = sorted(pronunciations)
    if args.benchmark:
        ordered = ordered[:args.benchmark]
    for number, ipa in enumerate(ordered, 1):
        conversions[ipa] = token_graph(converter, ipa)
        if number % 10000 == 0:
            print(f"Converted {number}/{len(ordered)} unique whole IPA pronunciations ({time.monotonic() - started:.1f}s).", flush=True)
    if args.benchmark:
        elapsed = time.monotonic() - started
        print(f"{len(ordered)} conversions in {elapsed:.2f}s; {len(pronunciations)} unique full pronunciations; estimated {elapsed / len(ordered) * len(pronunciations):.1f}s.")
        return
    result = {
        "schemaVersion": 2,
        "library": {"repository": "https://github.com/NRC-ILT/g2p", "revision": REVISION,
                    "api": "make_g2p('eng-ipa', 'eng-arpabet', tokenize=False, neural=False)",
                    "rulesPath": "g2p/mappings/langs/eng/eng_ipa_to_arpabet.json", "rulesSha256": sha256(rules_path.read_bytes())},
        "sourceAlignmentSha256": sha256(source),
        "note": "Library-generated whole-pronunciation graphs. Each event is [ARPAbet phone, sorted original IPA character indices]. Null means incomplete conversion or token graph coverage. Raw spelling epsilon segments remain separate. Restore CMU stress only after exact complete phone-sequence agreement.",
        "pronunciations": conversions,
    }
    serialized = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
    destination = ROOT / "data/upstream/nrc-ipa-graphs.json"
    if args.check:
        if destination.read_text() != serialized:
            raise ValueError("Vendored NRC graphs differ; run the preprocessing refresh")
        print(f"Verified {len(conversions)} library-generated whole-pronunciation graphs.")
    else:
        destination.write_text(serialized)
        print(f"Generated {len(conversions)} library graphs; sha256={sha256(serialized.encode())}")


if __name__ == "__main__":
    main()
