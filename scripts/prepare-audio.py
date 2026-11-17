# /// script
# requires-python = ">=3.11"
# dependencies = ["pocketsphinx==5.1.1"]
# [[tool.uv.index]]
# url = "https://pypi.org/simple"
# default = true
# ///
"""Rebuild four local WAVs and UNREVIEWED forced-alignment candidates.

Run: uv run --locked --no-config --script scripts/prepare-audio.py
Requires ffmpeg (PATH or /opt/homebrew/bin). Originals and source metadata
are checked in; this build step does not download anything.
"""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import wave

from pocketsphinx import Decoder, get_model_path

ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "public/audio"
PHONES = {
    "dad": ["D", "AE1", "D"],
    "she": ["SH", "IY1"],
    "hello": ["HH", "AH0", "L", "OW1"],
    "sheep": ["SH", "IY1", "P"],
}
SAMPLE_RATE = 44100
ALIGN_RATE = 16000
ALIGN_FRAME_RATE = 100


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ffmpeg = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    ffmpeg_version = subprocess.check_output([ffmpeg, "-version"], text=True).splitlines()[0]
    sources = json.loads((AUDIO / "sources.json").read_text())["sources"]
    # Keep the compact browser graph bound to the full, stressed source variant.
    graph_script = """import {buildDictionary} from './scripts/build-dictionary.mjs';
const d=buildDictionary(); const result={};
for (const word of ['dad','she','hello','sheep']) {
  const entry=d.words[word], variant=entry.variants.find(v=>v.id===word);
  if (!variant?.aligned) throw Error(`No aligned pilot variant: ${word}`);
  const graph=variant.entry ?? entry;
  result[word]={variantId:variant.id,phones:variant.pronunciation,graphPhonemes:graph.sounds.map(s=>s.phoneme)};
}
console.log(JSON.stringify(result));"""
    graphs = json.loads(subprocess.check_output(["node", "--input-type=module", "--eval", graph_script], cwd=ROOT, text=True))
    model = Path(get_model_path("en-us/en-us"))
    model_hashes = {str(p.relative_to(model)): digest(p) for p in sorted(model.rglob("*")) if p.is_file()}
    assets = {}
    for word, phones in PHONES.items():
        if graphs[word]["variantId"] != word or graphs[word]["phones"] != phones:
            raise ValueError(f"Current dictionary no longer matches pinned audio pronunciation: {word}")
        original = AUDIO / f"originals/{word}.ogg"
        if digest(original) != sources[word]["originalSha256"]:
            raise ValueError(f"Original hash mismatch: {word}")
        processed = AUDIO / f"{word}.wav"
        # Preserve the full duration, including silence. No phone splicing or loops.
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(original),
                        "-map_metadata", "-1", "-ac", "1", "-ar", str(SAMPLE_RATE),
                        "-c:a", "pcm_s16le", "-bitexact", str(processed)], check=True)
        with wave.open(str(processed)) as recording:
            frame_count = recording.getnframes()
        with tempfile.TemporaryDirectory(prefix="phonics-align-") as directory:
            align_wav = Path(directory) / "align.wav"
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(processed),
                            "-ac", "1", "-ar", str(ALIGN_RATE), "-c:a", "pcm_s16le", str(align_wav)], check=True)
            with wave.open(str(align_wav)) as recording:
                samples = recording.readframes(recording.getnframes())
        # API sequence documented by the installed PocketSphinx 5.1.1
        # Decoder.set_alignment docstring and official API reference:
        # https://pocketsphinx.readthedocs.io/en/latest/pocketsphinx.html#pocketsphinx.Decoder.set_alignment
        decoder = Decoder(hmm=str(model), samprate=ALIGN_RATE, frate=ALIGN_FRAME_RATE, loglevel="ERROR")
        expected = [re.sub(r"\d", "", phone) for phone in phones]
        # Force this exact pronunciation, rather than a dictionary-selected alternative.
        decoder.add_word("pilotword", " ".join(expected), True)
        decoder.set_align_text("pilotword")
        for second_pass in (False, True):
            if second_pass:
                decoder.set_alignment()
            decoder.start_utt()
            decoder.process_raw(samples, full_utt=True)
            decoder.end_utt()
        aligned = [phone for entry in decoder.get_alignment() if entry.name == "pilotword" for phone in entry]
        if [phone.name for phone in aligned] != expected:
            raise ValueError(f"Unexpected aligned phones: {word}")
        events = []
        for index, phone in enumerate(aligned):
            start = round(phone.start * SAMPLE_RATE / ALIGN_FRAME_RATE)
            end = round((phone.start + phone.duration) * SAMPLE_RATE / ALIGN_FRAME_RATE)
            if not 0 <= start < end <= frame_count:
                raise ValueError(f"Invalid alignment interval: {word}/{index}")
            events.append({"phoneIndex": index, "startFrame": start, "endFrame": end})
        assets[word] = {
            "word": word, "variantId": word, "phones": phones,
            "graphPhonemes": graphs[word]["graphPhonemes"],
            "audioUrl": f"audio/{word}.wav", "sha256": digest(processed),
            "sampleRate": SAMPLE_RATE, "frameCount": frame_count,
            "review": {
                "status": "candidate", "method": "PocketSphinx two-pass forced alignment",
                "toolVersion": importlib.metadata.version("pocketsphinx"),
                "humanReviewed": False, "listeningReviewed": False,
                "pronunciationStatus": "forced lexicon candidate; not listening-verified",
                "timingResolutionMs": 1000 // ALIGN_FRAME_RATE,
                "limitations": "Unreviewed acoustic-model estimates. Silence and stop boundaries may be inaccurate; coarticulation is ambiguous. No sustain regions approved.",
            },
            "events": events,
            "provenance": {
                **sources[word], "originalLocalUrl": f"audio/originals/{word}.ogg",
                "processedLicense": sources[word]["license"],
                "changes": "Decoded Ogg Vorbis to mono 44100 Hz signed 16-bit PCM WAV; stereo sources downmixed; metadata removed; full duration retained.",
                "ffmpegVersion": ffmpeg_version,
            },
        }
    manifest = {
        "schemaVersion": 1,
        "alignment": {"tool": "pocketsphinx", "version": importlib.metadata.version("pocketsphinx"),
                      "model": "bundled en-us/en-us acoustic model", "modelSha256": model_hashes,
                      "sampleRate": ALIGN_RATE, "framesPerSecond": ALIGN_FRAME_RATE,
                      "documentation": "https://pocketsphinx.readthedocs.io/en/latest/pocketsphinx.html#pocketsphinx.Decoder.set_alignment",
                      "note": "Build-time only. No model or aligner is shipped to the browser."},
        "words": assets,
    }
    (AUDIO / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("Prepared four WAVs and unreviewed timing candidates; manual listening/timing review remains required.")


if __name__ == "__main__":
    main()
