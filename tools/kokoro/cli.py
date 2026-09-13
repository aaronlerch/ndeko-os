#!/usr/bin/env python3
"""
Kokoro CLI wrapper — fast fixed-voice TTS.

Subcommands:
  tts     --voice <name|blend> --text <str|@file> --out <path>
          [--speed <f>] [--lang <code>] [--sentence-pause <s>] [--clause-pause <s>]
          [--continuous] [--timings <path.json>]
  voices  [--lang <code>] [--all]
  langs

The complement to the Chatterbox CLI next door, not a replacement:

  chatterbox  cloned voices, cue tags ([sigh], [laugh]), expressive. ~realtime
              on turbo, 1.5-2.4x SLOWER than realtime on standard. 1.5G venv.
  kokoro      54 fixed voices, no cloning, no emotion tags at all. 12-22x
              realtime on CPU. ~500M on disk. Deterministic: same text in, same
              audio out, every time.

Reach for kokoro when the job is narration and for chatterbox when the job is a
voice. (Verified against kokoro-onnx 0.6.1, 2026-09-13.)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

HOME = Path.home()
ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"

# Kokoro ships no [pause] token — no Kokoro token is a control token, the model
# reads brackets aloud. It is honoured here the same way the chatterbox CLI does
# it: split the text and splice real silence, which is the only beat that does
# not depend on the model's whim. `--sentence-pause` / `--clause-pause` are the
# model's own (natural, punctuation-driven) gaps and are a different lever.
PAUSE_RE = re.compile(r"\[pause(?::\s*([0-9]*\.?[0-9]+))?\]", re.IGNORECASE)
DEFAULT_PAUSE_SEC = 0.6
# Anything else in brackets would be spoken as literal characters. Kokoro has no
# cue tags, so a storyboard ported over from chatterbox gets warned, not read out.
ANY_TAG_RE = re.compile(r"\[[a-z][a-z ]*(?::[0-9.]+)?\]", re.IGNORECASE)

# Voice names encode language and gender in their first two letters. Verified by
# construction: the per-language counts this table produces match the nine counts
# in hexgrad's VOICES.md exactly (2026-09-13).
LANG_BY_PREFIX = {
    "a": ("en-us", "American English"),
    "b": ("en-gb", "British English"),
    "e": ("es", "Spanish"),
    "f": ("fr-fr", "French"),
    "h": ("hi", "Hindi"),
    "i": ("it", "Italian"),
    "j": ("ja", "Japanese"),
    "p": ("pt-br", "Brazilian Portuguese"),
    "z": ("cmn", "Mandarin Chinese"),
}

# Grades are hexgrad's own, from VOICES.md. ONLY the three that are actually
# published above C are recorded — the rest are left blank rather than invented,
# because a made-up grade is worse than no grade. The practical read: there are
# three good voices and they are all female.
GRADES = {"af_heart": "A", "af_bella": "A-", "bf_emma": "B-"}
DEFAULT_VOICE = "af_heart"

# Kokoro's G2P is espeak-ng, which guesses at anything not in its dictionary and
# is confidently wrong about names it has not seen. It mispronounces this very
# model: "Kokoro" comes out kəkˈɔːɹoʊ ("kuh-KOR-oh"). There is no inline escape — espeak's own [[phoneme]] syntax is
# mangled by the phonemizer wrapper before espeak ever sees it (verified
# 2026-09-13), so the ONLY precise lever is to phonemize the text here and hand
# the model phonemes with is_phonemes=True.
#
# The lexicon lives in the DATA tree, not here. That is a privacy boundary, not
# a preference: the words worth fixing are employer, customer and product names,
# and this repo must stay free of those.


def fail(msg: str, code: int = 1):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def _data_root() -> Path:
    """Mirrors hooks/lib/paths.ts: NDEKO_DATA_DIR wins, else the default."""
    env = os.environ.get("NDEKO_DATA_DIR", "").strip()
    if env:
        return Path(os.path.expandvars(env)).expanduser()
    return HOME / ".config" / "ndeko-os"


def default_voice() -> str:
    """Same resolution ladder the Say skill uses, on its own file.

    Kokoro voices and chatterbox profiles are different namespaces — `aaron` is
    meaningless here and `af_heart` is meaningless there — so this reads
    .default-kokoro, NOT the .default that chatterbox owns.
    """
    f = _data_root() / "voice-profiles" / ".default-kokoro"
    try:
        name = f.read_text().strip()
        return name or DEFAULT_VOICE
    except OSError:
        return DEFAULT_VOICE


def lexicon_path() -> Path:
    return _data_root() / "voice-profiles" / "kokoro-lexicon.json"


def load_lexicon() -> dict[str, dict]:
    f = lexicon_path()
    try:
        data = json.loads(f.read_text())
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as e:
        # A corrupt lexicon must not silently revert every word to the espeak
        # guess — that is the failure this whole file exists to stop.
        fail(f"lexicon at {f} is unreadable: {e}")
    return {k.lower(): v for k, v in (data.get("entries") or {}).items()}


def save_lexicon(entries: dict[str, dict]):
    f = lexicon_path()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"version": 1, "entries": entries}, indent=2, ensure_ascii=False) + "\n")


def apply_lexicon(text: str, lang: str, entries: dict[str, dict]) -> tuple[str | None, list[str]]:
    """Phonemize `text`, substituting lexicon IPA for the terms it covers.

    Returns (phoneme_string, applied_terms). The phoneme string is None when no
    term matched, which is the signal to skip phoneme mode entirely and let
    kokoro-onnx phonemize normally — the cheaper and better-tested path.
    """
    if not entries:
        return None, []
    from kokoro_onnx.tokenizer import Tokenizer

    # Longest term first, so a two-word term wins over its first word alone.
    terms = sorted(entries, key=len, reverse=True)
    pattern = re.compile(r"\b(" + "|".join(re.escape(t) for t in terms) + r")\b", re.IGNORECASE)
    if not pattern.search(text):
        return None, []

    tok = Tokenizer()
    pieces: list[str] = []
    applied: list[str] = []
    for i, frag in enumerate(pattern.split(text)):
        if not frag:
            continue
        if i % 2:  # capture group — a lexicon term
            ipa = entries[frag.lower()]["ipa"]
            kept = tok.known(ipa)
            if kept != ipa:
                print(f"warning: dropped {sorted(set(ipa) - set(kept))} from '{frag}' — "
                      f"outside Kokoro's phoneme vocabulary", file=sys.stderr)
            pieces.append(kept)
            applied.append(frag)
        elif frag.strip():
            pieces.append(tok.phonemize(frag, lang))
        elif pieces:
            pieces.append(" ")
    # Collapse the seams: fragments were phonemized apart, so spacing is ours.
    return re.sub(r"\s+", " ", " ".join(pieces)).strip(), applied


def model_paths() -> tuple[Path, Path]:
    voices = MODELS / "voices-v1.0.bin"
    onnx = next((MODELS / n for n in (
        "kokoro-v1.0.onnx", "kokoro-v1.0.fp16.onnx", "kokoro-v1.0.int8.onnx",
    ) if (MODELS / n).is_file()), None)
    if onnx is None or not voices.is_file():
        fail(f"model files missing from {MODELS} — run {ROOT / 'setup.sh'}")
    return onnx, voices


def read_text_arg(value: str) -> str:
    if value.startswith("@"):
        p = Path(value[1:]).expanduser()
        if not p.is_file():
            fail(f"text file not found: {p}")
        return p.read_text()
    return value


def split_pauses(text: str) -> list[tuple[str, float]]:
    """Split on [pause] / [pause:N]. Returns (segment, silence_after_sec) pairs."""
    out: list[tuple[str, float]] = []
    pos = 0
    for m in PAUSE_RE.finditer(text):
        seg = text[pos:m.start()].strip()
        gap = float(m.group(1)) if m.group(1) else DEFAULT_PAUSE_SEC
        if seg:
            out.append((seg, gap))
        elif out:
            # Back-to-back or leading marker: fold onto the previous gap.
            prev_text, prev_gap = out[-1]
            out[-1] = (prev_text, prev_gap + gap)
        pos = m.end()
    tail = text[pos:].strip()
    if tail:
        out.append((tail, 0.0))
    return out or [(text.strip(), 0.0)]


def warn_unreadable_tags(text: str):
    stray = {m.group(0) for m in ANY_TAG_RE.finditer(text)
             if not PAUSE_RE.fullmatch(m.group(0))}
    if stray:
        print(f"warning: Kokoro has no cue tags — {sorted(stray)} will be read aloud "
              f"as literal text. Strip them, or use the chatterbox CLI (turbo/nano), "
              f"which does understand them.", file=sys.stderr)


def lang_for_voice(name: str) -> str:
    return LANG_BY_PREFIX.get(name[:1], ("en-us", ""))[0]


def parse_voice_spec(spec: str, kokoro):
    """Resolve a voice name, or a weighted blend like 'af_heart:0.6,bf_emma:0.4'.

    Kokoro voices are plain (510, 1, 256) style vectors, so a weighted sum is a
    real, stable third voice rather than a crossfade of two renders. Weights are
    normalised, so '3,1' and '0.75,0.25' mean the same thing.
    """
    known = set(kokoro.get_voices())
    if "," not in spec and ":" not in spec:
        if spec not in known:
            near = [v for v in sorted(known) if spec.lower() in v.lower()]
            fail(f"unknown voice '{spec}'"
                 + (f" — did you mean: {', '.join(near[:5])}?" if near else
                    f" — run `{ROOT / 'kokoro'} voices` for the list"))
        return spec, spec

    parts: list[tuple[str, float]] = []
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        name, _, w = chunk.partition(":")
        name = name.strip()
        if name not in known:
            fail(f"unknown voice '{name}' in blend '{spec}'")
        try:
            weight = float(w) if w.strip() else 1.0
        except ValueError:
            fail(f"bad weight '{w}' for '{name}' — expected a number")
        if weight < 0:
            fail(f"negative weight for '{name}'")
        parts.append((name, weight))
    if not parts:
        fail(f"empty voice spec '{spec}'")
    total = sum(w for _, w in parts)
    if total <= 0:
        fail(f"blend weights sum to zero in '{spec}'")

    import numpy as np
    style = None
    for name, weight in parts:
        piece = kokoro.get_voice_style(name) * (weight / total)
        style = piece if style is None else np.add(style, piece)
    label = " + ".join(f"{n}:{w / total:.2f}" for n, w in parts)
    return style, label


def cmd_tts(args):
    import numpy as np
    import soundfile as sf
    from kokoro_onnx import Kokoro

    text = read_text_arg(args.text).strip()
    if not text:
        fail("no text to speak")
    warn_unreadable_tags(text)

    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    onnx, voices_bin = model_paths()
    kokoro = Kokoro(str(onnx), str(voices_bin))
    voice, label = parse_voice_spec(args.voice, kokoro)

    # A Japanese voice fed en-us phonemes produces confident nonsense, so the
    # language follows the voice unless it is asked for explicitly.
    lang = args.lang or lang_for_voice(args.voice.split(",")[0].split(":")[0])

    print(f"kokoro: voice={label} lang={lang} speed={args.speed}"
          f"{' continuous' if args.continuous else ''}", file=sys.stderr)

    kwargs = dict(
        voice=voice, speed=args.speed, lang=lang,
        sentence_pause=args.sentence_pause, clause_pause=args.clause_pause,
        continuous=args.continuous,
    )

    entries = {} if args.no_lexicon else load_lexicon()
    all_applied: list[str] = []

    tracks: list[np.ndarray] = []
    timings: list[dict] = []
    offset = 0.0
    sr = 24000
    for seg_text, pause_after in split_pauses(text):
        # Phoneme mode only when the lexicon actually covers something in this
        # segment; otherwise let kokoro-onnx phonemize, which is the path its own
        # normalisation and tests assume.
        phonemes, applied = apply_lexicon(seg_text, lang, entries)
        seg_kwargs = dict(kwargs, is_phonemes=phonemes is not None)
        render_text = phonemes if phonemes is not None else seg_text
        all_applied.extend(applied)

        if args.timings:
            samples, sr, segment_timings = kokoro.create_timed(render_text, **seg_kwargs)
            for t in segment_timings:
                timings.append({"phoneme": t.phoneme,
                                "start": round(t.start + offset, 4),
                                "end": round(t.end + offset, 4)})
        else:
            samples, sr = kokoro.create(render_text, **seg_kwargs)
        tracks.append(samples)
        offset += len(samples) / sr
        if pause_after > 0:
            silence = np.zeros(int(sr * pause_after), dtype=samples.dtype)
            tracks.append(silence)
            offset += pause_after

    combined = np.concatenate(tracks) if len(tracks) > 1 else tracks[0]
    sf.write(str(out_path), combined, sr)

    duration = len(combined) / sr
    if all_applied:
        print(f"kokoro: pronunciation lexicon applied to {sorted(set(all_applied))}",
              file=sys.stderr)
    print(f"kokoro: {duration:.2f}s of audio -> {out_path}", file=sys.stderr)

    if args.timings:
        tpath = Path(args.timings).expanduser()
        tpath.parent.mkdir(parents=True, exist_ok=True)
        tpath.write_text(json.dumps(
            {"audio": str(out_path), "sample_rate": sr,
             "duration": round(duration, 4), "timings": timings}, indent=2))
        print(f"kokoro: {len(timings)} phoneme timings -> {tpath}", file=sys.stderr)

    # Last line on stdout is the artifact path, matching the chatterbox CLI.
    print(str(out_path))


def cmd_voices(args):
    from kokoro_onnx import Kokoro
    onnx, voices_bin = model_paths()
    names = sorted(Kokoro(str(onnx), str(voices_bin)).get_voices())

    rows = []
    for n in names:
        code, language = LANG_BY_PREFIX.get(n[:1], ("?", "?"))
        if args.lang and args.lang not in (code, n[:1]):
            continue
        gender = {"f": "female", "m": "male"}.get(n[1:2], "?")
        rows.append((n, language, code, gender, GRADES.get(n, "")))

    if not rows:
        fail(f"no voices for --lang {args.lang} (try: {', '.join(sorted({c for c, _ in LANG_BY_PREFIX.values()}))})")

    w = max(len(r[0]) for r in rows)
    print(f"{'voice'.ljust(w)}  {'language'.ljust(21)} {'code'.ljust(6)} {'gender'.ljust(7)} grade")
    for n, language, code, gender, grade in rows:
        print(f"{n.ljust(w)}  {language.ljust(21)} {code.ljust(6)} {gender.ljust(7)} {grade}")

    if not args.lang:
        print()
        print(f"default: {default_voice()}  "
              f"(set with: echo <voice> > {_data_root() / 'voice-profiles' / '.default-kokoro'})")
        print("Graded above C by hexgrad: af_heart (A), af_bella (A-), bf_emma (B-).")
        print("Everything else is C/D — usable, but audition it before shipping.")
        print("Blend two into a third:  --voice 'af_heart:0.6,bf_emma:0.4'")


def cmd_pronounce(args):
    entries = load_lexicon()

    if args.remove:
        key = args.remove.lower()
        if key not in entries:
            fail(f"no lexicon entry for '{args.remove}'")
        del entries[key]
        save_lexicon(entries)
        print(f"removed '{args.remove}' from {lexicon_path()}")
        return

    if args.add:
        if not args.ipa:
            fail("--add needs --ipa, e.g. --add Kokoro --ipa 'kˈoʊkoɹoʊ'\n"
                 "       Audition candidates first: kokoro pronounce --audition Kokoro "
                 "--ipa '...' --ipa '...'")
        if len(args.ipa) > 1:
            fail(f"--add takes one --ipa, got {len(args.ipa)}. Use --audition to compare, "
                 f"then --add the winner.")
        from kokoro_onnx.tokenizer import Tokenizer
        ipa = args.ipa[0]
        kept = Tokenizer().known(ipa)
        if kept != ipa:
            print(f"warning: dropped {sorted(set(ipa) - set(kept))} — outside Kokoro's "
                  f"phoneme vocabulary; storing {kept!r}", file=sys.stderr)
        entries[args.add.lower()] = {"ipa": kept,
                                     **({"because": args.because} if args.because else {})}
        save_lexicon(entries)
        print(f"'{args.add}' -> {kept}  ({lexicon_path()})")
        return

    if args.audition:
        if not args.ipa:
            fail("--audition needs at least one --ipa candidate")
        import soundfile as sf
        from kokoro_onnx import Kokoro
        from kokoro_onnx.tokenizer import Tokenizer
        onnx, voices_bin = model_paths()
        kokoro = Kokoro(str(onnx), str(voices_bin))
        tok = Tokenizer()
        voice_spec = args.voice or default_voice()
        voice, label = parse_voice_spec(voice_spec, kokoro)
        lang = args.lang or lang_for_voice(voice_spec.split(",")[0].split(":")[0])
        sentence = args.sentence or f"{args.audition}. Say hello to {args.audition}."
        out_dir = Path(args.out_dir).expanduser()
        out_dir.mkdir(parents=True, exist_ok=True)

        # The espeak guess renders too, as the control. Judging a candidate
        # without the thing it is meant to replace in the same ear is guesswork.
        print(f"auditioning '{args.audition}' in {label}:", file=sys.stderr)
        rows = [("espeak-default", None)] + [(f"cand{i}", c) for i, c in enumerate(args.ipa, 1)]
        for name, ipa in rows:
            if ipa is None:
                ph = tok.phonemize(sentence, lang)
                shown = "(espeak's own guess)"
            else:
                kept = tok.known(ipa)
                pattern = re.compile(r"\b" + re.escape(args.audition) + r"\b", re.IGNORECASE)
                parts = [kept if i % 2 else tok.phonemize(f, lang)
                         for i, f in enumerate(pattern.split(sentence)) if f.strip()]
                ph = re.sub(r"\s+", " ", " ".join(parts)).strip()
                shown = kept
            samples, sr = kokoro.create(ph, voice=voice, lang=lang, is_phonemes=True)
            path = out_dir / f"{args.audition.lower()}-{name}.wav"
            sf.write(str(path), samples, sr)
            print(f"  {name:15} {shown}")
            print(f"    afplay {path}")
        print(f"\nPick one, then: kokoro pronounce --add {args.audition} --ipa '<winner>'",
              file=sys.stderr)
        return

    if args.test:
        from kokoro_onnx.tokenizer import Tokenizer
        lang = args.lang or "en-us"
        raw = Tokenizer().phonemize(args.test, lang)
        fixed, applied = apply_lexicon(args.test, lang, entries)
        print(f"without lexicon: {raw}")
        if fixed is None:
            print("with lexicon:    (no entry matched — identical)")
        else:
            print(f"with lexicon:    {fixed}")
            print(f"applied:         {sorted(set(applied))}")
        return

    # Default: list.
    if not entries:
        print(f"(no entries) — {lexicon_path()}")
        print("\nAdd one:  kokoro pronounce --add Kokoro --ipa 'kˈoʊkoɹoʊ'")
        print("Compare:  kokoro pronounce --audition Kokoro --ipa 'kˈoʊkoɹoʊ' --ipa 'koʊkˈoɹoʊ'")
        return
    w = max(len(k) for k in entries)
    for term, entry in sorted(entries.items()):
        because = f"   # {entry['because']}" if entry.get("because") else ""
        print(f"{term.ljust(w)}  {entry['ipa']}{because}")
    print(f"\n{lexicon_path()}")


def cmd_langs(args):
    print(f"{'code'.ljust(7)} {'prefix'.ljust(7)} language")
    for prefix, (code, language) in sorted(LANG_BY_PREFIX.items(), key=lambda kv: kv[1][0]):
        print(f"{code.ljust(7)} {prefix.ljust(7)} {language}")
    print()
    print("The language follows the voice automatically; --lang only overrides it.")
    print("hexgrad flags non-English as thin — weak G2P and less training data.")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="kokoro", description="Kokoro TTS (fast, fixed voices, no cloning)")
    sub = p.add_subparsers(dest="cmd", required=True)

    t = sub.add_parser("tts", help="Generate speech from text")
    t.add_argument("--voice", default=None,
                   help="voice name, or weighted blend 'af_heart:0.6,bf_emma:0.4'")
    t.add_argument("--text", required=True, help="text to speak, or @/path/to/file")
    t.add_argument("--out", required=True, help="output .wav path")
    t.add_argument("--speed", type=float, default=1.0, help="0.5-2.0, default 1.0")
    t.add_argument("--lang", default=None, help="override the voice's language code")
    t.add_argument("--sentence-pause", type=float, default=0.25,
                   help="model gap after sentence-final punctuation (default 0.25)")
    t.add_argument("--clause-pause", type=float, default=0.1,
                   help="model gap at commas and clause breaks (default 0.1)")
    t.add_argument("--continuous", action="store_true",
                   help="synthesise as overlapping windows so prosody runs across "
                        "joins — costs ~1.4x, worth it on long paragraphs")
    t.add_argument("--no-lexicon", action="store_true",
                   help="ignore the pronunciation lexicon for this render")
    t.add_argument("--timings", default=None,
                   help="also write phoneme timings as JSON to this path")
    t.set_defaults(func=cmd_tts)

    v = sub.add_parser("voices", help="List available voices")
    v.add_argument("--lang", default=None, help="filter by language code or prefix letter")
    v.set_defaults(func=cmd_voices)

    pr = sub.add_parser("pronounce", help="Teach Kokoro how to say a word")
    pr.add_argument("--add", default=None, help="term to add or overwrite")
    pr.add_argument("--ipa", action="append", default=None,
                    help="IPA phonemes; repeat to supply --audition candidates")
    pr.add_argument("--because", default=None, help="note why, for the next reader")
    pr.add_argument("--remove", default=None, help="term to delete")
    pr.add_argument("--test", default=None, help="show the phonemes a sentence would produce")
    pr.add_argument("--audition", default=None,
                    help="render each --ipa candidate for this term, plus the espeak control")
    pr.add_argument("--sentence", default=None, help="sentence to use for --audition")
    pr.add_argument("--voice", default=None, help="voice for --audition")
    pr.add_argument("--lang", default=None, help="language code")
    pr.add_argument("--out-dir", default="/tmp/kokoro-pronounce", help="where --audition writes")
    pr.set_defaults(func=cmd_pronounce)

    sub.add_parser("langs", help="List language codes").set_defaults(func=cmd_langs)
    return p


def main():
    args = build_parser().parse_args()
    if getattr(args, "voice", None) is None and args.cmd == "tts":
        args.voice = default_voice()
    args.func(args)


if __name__ == "__main__":
    main()
