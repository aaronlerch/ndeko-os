#!/usr/bin/env python3
"""
Chatterbox CLI wrapper — voice profile management and TTS generation.

Subcommands:
  clone   --name <n> --sample <path>... [--force] [--notes <text>]
  rebuild --profile <n>            # regenerate reference.wav from stored sources
  tts     --profile <n> --text <str|@file> --out <path>
          [--model turbo|standard|multilingual|nano] [--device auto|cpu|mps|cuda]
          [--seed N] [--candidates N] [--exaggeration <f>] [--cfg-weight <f>]
  list
  show    --profile <n>
  delete  --profile <n> --force

Model notes (verified against chatterbox-tts @ github master, 2026-08-31):
  turbo         350M, GPT2-medium backbone, meanflow decoder pinned to 2 CFM
                steps. Fast. The ONLY tier that understands inline cue tags.
  standard      500M. Non-meanflow decoder, 10 CFM steps — 5x the vocoder work
                per clip, and the reason it sounds cleaner than turbo.
                Honours exaggeration + cfg_weight. No cue tags.
  multilingual  500M, 23 languages, v3 weights by default. Same 10-step decoder
                as standard plus a newer T3; Resemble bills it as improved
                speaker similarity. Honours exaggeration + cfg_weight.
  nano          110M. Smaller/faster sibling of turbo, same cue tags. Here for
                completeness — it is the speed tier, not the quality tier.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
import os
from pathlib import Path

HOME = Path.home()

# Voice profiles are recordings of real people — personal data. They live in the
# ndeko DATA tree, never in the harness repo, which is public-clonable and must
# stay free of anything personal. This mirrors the resolution order in
# hooks/lib/paths.ts: NDEKO_DATA_DIR wins, else the canonical default.
def _data_root() -> Path:
    env = os.environ.get("NDEKO_DATA_DIR", "").strip()
    if env:
        return Path(os.path.expandvars(env)).expanduser()
    return HOME / ".config" / "ndeko-os"


PROFILE_ROOT = _data_root() / "voice-profiles"

# 15s, because that is the longest *conditioning prompt* any model reads:
# turbo/nano slice ENC_COND_LEN = 15s for the speech-cond prompt, while
# standard/multilingual take 6s enc + 10s dec and truncate the rest. A longer
# reference is therefore free for the small models and strictly better for the
# big one. (Was 10s, which starved turbo of a third of its conditioning.)
#
# Above 15s is not wasted either, and this is the non-obvious part: every tier
# computes `ref_16k_wav` from the WHOLE file and hands all of it to
# `ve.embeds_from_wavs`, so the speaker embedding keeps improving with length
# even though the prompt slices do not. That is what --seconds is for; 30-60s
# of clean speech is worth A/B-ing when a profile has the material.
# The floor is a hard model assert: prepare_conditionals refuses <= 5s.
REFERENCE_SECONDS = 15
REFERENCE_MIN_SECONDS = 5.5
REFERENCE_SAMPLE_RATE = 24000
NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
# Chatterbox degrades on long single-shot inputs — empirically, ~300 chars is
# the reliable ceiling. Auto-chunking splits longer text by paragraph then
# sentence, generates each chunk with the same model load, concats the tensors.
DEFAULT_CHUNK_MAX_CHARS = 300
DEFAULT_CHUNK_SILENCE_SEC = 0.35
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

# Cue tags, read out of the turbo checkpoint's added_tokens.json. These are real
# vocabulary entries on turbo and nano ONLY — every other tier tokenises them as
# literal bracket characters and reads them aloud, so they get stripped there.
CUE_TAGS = {
    "[advertisement]", "[angry]", "[chuckle]", "[clear throat]", "[cough]",
    "[crying]", "[dramatic]", "[fear]", "[gasp]", "[groan]", "[happy]",
    "[laugh]", "[narration]", "[sarcastic]", "[shush]", "[sigh]", "[sniff]",
    "[surprised]", "[whispering]",
}
CUE_MODELS = {"turbo", "nano"}
ANY_TAG_RE = re.compile(r"\[[a-z][a-z ]*\]", re.IGNORECASE)

# [pause] is NOT a model token — no tier has one. It is honoured here by
# splitting the text and inserting real silence, which is the only way to get a
# deliberate beat that does not depend on the model's whim.
PAUSE_RE = re.compile(r"\[pause(?::\s*([0-9]*\.?[0-9]+))?\]", re.IGNORECASE)
DEFAULT_PAUSE_SEC = 0.6


def chunk_text(text: str, max_chars: int) -> list[str]:
    """Split text into chunks <= max_chars, preferring paragraph, then sentence."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    for para in paragraphs:
        if len(para) <= max_chars:
            chunks.append(para)
            continue
        sentences = SENTENCE_SPLIT_RE.split(para)
        current = ""
        for s in sentences:
            s = s.strip()
            if not s:
                continue
            # If a single sentence is longer than max_chars, emit it alone
            # (Chatterbox will probably do fine; better than mid-sentence cut).
            if len(s) > max_chars:
                if current:
                    chunks.append(current.strip())
                    current = ""
                chunks.append(s)
                continue
            if current and len(current) + 1 + len(s) > max_chars:
                chunks.append(current.strip())
                current = s
            else:
                current = f"{current} {s}".strip()
        if current:
            chunks.append(current.strip())
    return chunks


def split_pauses(text: str) -> list[tuple[str, float]]:
    """Split on [pause] / [pause:N] markers.

    Returns (segment_text, silence_after_seconds) pairs. The silence is rendered
    as real samples, so the beat is exactly as long as it was asked to be.
    """
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


def prepare_text(text: str, model: str) -> str:
    """Strip cue tags the chosen model cannot read, and warn about typos."""
    if model in CUE_MODELS:
        for m in ANY_TAG_RE.finditer(text):
            tag = m.group(0).lower()
            if tag not in CUE_TAGS and not PAUSE_RE.fullmatch(m.group(0)):
                print(f"warning: '{m.group(0)}' is not a turbo/nano cue tag — it will be "
                      f"read aloud. Known tags: {', '.join(sorted(CUE_TAGS))}", file=sys.stderr)
        return text
    found = [m.group(0) for m in ANY_TAG_RE.finditer(text) if m.group(0).lower() in CUE_TAGS]
    if found:
        print(f"warning: cue tags {sorted(set(found))} are turbo/nano-only — stripping them "
              f"for --model {model}, which would otherwise read them aloud.", file=sys.stderr)
        for tag in set(found):
            text = re.sub(re.escape(tag), " ", text, flags=re.IGNORECASE)
        text = " ".join(text.split())
    return text


def fail(msg: str, code: int = 1):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def validate_name(name: str):
    if not NAME_PATTERN.match(name):
        fail(f"invalid profile name '{name}' (must start with alphanumeric; body may include dashes and underscores; max 64 chars)")


def profile_dir(name: str) -> Path:
    return PROFILE_ROOT / name


def read_text_arg(value: str) -> str:
    if value.startswith("@"):
        p = Path(value[1:]).expanduser()
        if not p.is_file():
            fail(f"text file not found: {p}")
        return p.read_text()
    return value


def detect_device(requested: str) -> str:
    if requested != "auto":
        return requested
    try:
        import torch
    except ImportError:
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    # Apple Silicon: measured ~4x faster than CPU on an M-series part, and the
    # models load to CPU first internally so there is no fp32/fp64 trap here.
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def probe_duration(path: Path) -> float | None:
    if not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        return round(float(out), 2) if out else None
    except (subprocess.CalledProcessError, ValueError):
        return None


def build_reference(samples: list[Path], out: Path, seconds: int = REFERENCE_SECONDS) -> float | None:
    """Concatenate every sample, then take the first REFERENCE_SECONDS.

    Concatenating matters: the old code silently used samples[0] and ignored the
    rest, so passing three clips bought nothing. More distinct speech in the
    window is exactly what the speaker encoder averages over.
    """
    if not shutil.which("ffmpeg"):
        fail("ffmpeg not installed — needed to normalize reference audio")

    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    for s in samples:
        cmd += ["-i", str(s)]
    if len(samples) > 1:
        inputs = "".join(f"[{i}:a]" for i in range(len(samples)))
        cmd += ["-filter_complex", f"{inputs}concat=n={len(samples)}:v=0:a=1[a]", "-map", "[a]"]
    cmd += [
        "-t", str(seconds),
        "-ac", "1",
        "-ar", str(REFERENCE_SAMPLE_RATE),
        "-sample_fmt", "s16",
        str(out),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        fail(f"ffmpeg failed: {e.stderr.strip() or e.stdout.strip()}")

    duration = probe_duration(out)
    if duration is not None and duration < REFERENCE_MIN_SECONDS:
        fail(f"reference is {duration}s — chatterbox asserts on anything under 5s. "
             f"Supply a longer sample, or several with repeated --sample.")
    return duration


def cmd_clone(args):
    validate_name(args.name)
    pdir = profile_dir(args.name)
    if pdir.exists():
        if not args.force:
            fail(f"profile '{args.name}' already exists (pass --force to overwrite)")
        shutil.rmtree(pdir)
    pdir.mkdir(parents=True, exist_ok=True)

    samples = [Path(s).expanduser().resolve() for s in args.sample]
    for s in samples:
        if not s.is_file():
            shutil.rmtree(pdir, ignore_errors=True)
            fail(f"sample not found: {s}")

    sources_dir = pdir / "sources"
    sources_dir.mkdir(exist_ok=True)
    local_samples: list[Path] = []
    for s in samples:
        target = sources_dir / s.name
        i = 2
        while target.exists():
            target = sources_dir / f"{s.stem}-{i}{s.suffix}"
            i += 1
        shutil.copy2(s, target)
        local_samples.append(target)

    duration = build_reference(local_samples, pdir / "reference.wav", args.seconds)

    profile = {
        "name": args.name,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_samples": [str(s.relative_to(pdir)) for s in local_samples],
        "original_source_paths": [str(s) for s in samples],
        "reference_duration_sec": duration,
        "reference_seconds_target": args.seconds,
        "defaults": {"exaggeration": 0.5, "cfg_weight": 0.5},
        "notes": args.notes or "",
    }
    (pdir / "profile.json").write_text(json.dumps(profile, indent=2) + "\n")

    print(f"saved profile '{args.name}' at {pdir}")
    if duration is not None:
        print(f"reference duration: {duration}s")


def cmd_rebuild(args):
    """Regenerate reference.wav from the sources already stored in the profile.

    Exists so a profile cloned under the old 10s ceiling can pick up the 15s
    window without the original audio being hunted down again.
    """
    validate_name(args.profile)
    pdir = profile_dir(args.profile)
    if not pdir.is_dir():
        fail(f"profile '{args.profile}' not found")
    sources_dir = pdir / "sources"
    samples = sorted(p for p in sources_dir.iterdir() if p.is_file()) if sources_dir.is_dir() else []
    if not samples:
        fail(f"profile '{args.profile}' has no stored sources to rebuild from ({sources_dir})")

    before = probe_duration(pdir / "reference.wav")
    duration = build_reference(samples, pdir / "reference.wav", args.seconds)

    meta = pdir / "profile.json"
    if meta.is_file():
        try:
            j = json.loads(meta.read_text())
        except json.JSONDecodeError:
            j = {}
        j["reference_duration_sec"] = duration
        j["reference_seconds_target"] = args.seconds
        j["source_samples"] = [str(s.relative_to(pdir)) for s in samples]
        j["rebuilt_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        meta.write_text(json.dumps(j, indent=2) + "\n")

    print(f"rebuilt reference for '{args.profile}' from {len(samples)} source(s): "
          f"{before}s -> {duration}s")


def load_model(model: str, device: str, mtl_version: str):
    try:
        if model == "turbo":
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            return ChatterboxTurboTTS.from_pretrained(device=device)
        if model == "nano":
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            return ChatterboxTurboTTS.from_pretrained(device=device, nano=True)
        if model == "multilingual":
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
            return ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model=mtl_version)
        from chatterbox.tts import ChatterboxTTS
        return ChatterboxTTS.from_pretrained(device=device)
    except ImportError as e:
        fail(f"chatterbox-tts not installed or too old: {e} — run setup.sh")
    except TypeError as e:
        # nano= and t3_model= only exist on the git-master build.
        fail(f"this chatterbox build does not support --model {model} ({e}) — "
             f"re-run setup.sh to pull the current version")


def cmd_tts(args):
    validate_name(args.profile)
    pdir = profile_dir(args.profile)
    if not pdir.is_dir():
        fail(f"profile '{args.profile}' not found (run 'chatterbox list' to see profiles)")
    reference_wav = pdir / "reference.wav"
    if not reference_wav.is_file():
        fail(f"profile '{args.profile}' is missing reference.wav at {reference_wav}")

    profile_json = pdir / "profile.json"
    profile = json.loads(profile_json.read_text()) if profile_json.is_file() else {}
    defaults = profile.get("defaults", {}) or {}

    ref_len = probe_duration(reference_wav)
    if ref_len is not None and ref_len < REFERENCE_SECONDS - 0.5 and args.model in CUE_MODELS:
        print(f"note: reference is {ref_len}s but {args.model} conditions on up to "
              f"{REFERENCE_SECONDS}s — run 'chatterbox rebuild --profile {args.profile}' "
              f"to widen it if longer source audio is stored.", file=sys.stderr)

    text = read_text_arg(args.text).strip()
    if not text:
        fail("text is empty")
    text = prepare_text(text, args.model)

    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    device = detect_device(args.device)

    try:
        import torch
        import torchaudio
    except ImportError as e:
        fail(f"torch not installed: {e} — run setup.sh")

    model = load_model(args.model, device, args.mtl_version)
    sr = getattr(model, "sr", None) or getattr(model, "sample_rate", 24000)

    base_kwargs = {}
    if args.model == "multilingual":
        base_kwargs["language_id"] = args.language
    if args.model in ("standard", "multilingual"):
        # exaggeration and cfg_weight are real knobs only on the 10-step tiers.
        # cfg_weight is the pacing control: ~0.3 slows delivery down, which is
        # what narration usually wants; 0.5 is the shipped default.
        exaggeration = args.exaggeration if args.exaggeration is not None else defaults.get("exaggeration")
        cfg_weight = args.cfg_weight if args.cfg_weight is not None else defaults.get("cfg_weight")
        if exaggeration is not None:
            base_kwargs["exaggeration"] = float(exaggeration)
        if cfg_weight is not None:
            base_kwargs["cfg_weight"] = float(cfg_weight)
    else:
        # Turbo/nano sampling knobs. Turbo's T3Config sets emotion_adv=False, so
        # exaggeration and cfg_weight are inert there no matter what is passed.
        if args.temperature is not None:
            base_kwargs["temperature"] = float(args.temperature)
        if args.top_p is not None:
            base_kwargs["top_p"] = float(args.top_p)
        if args.repetition_penalty is not None:
            base_kwargs["repetition_penalty"] = float(args.repetition_penalty)
        base_kwargs["norm_loudness"] = args.norm_loudness

    # Condition ONCE, not once per chunk. Passing audio_prompt_path into
    # generate() makes it re-run prepare_conditionals every call — reloading and
    # resampling the reference, re-tokenising the speech prompt and re-running
    # the voice encoder for every chunk of a long narration. Preparing up front
    # does that work a single time and keeps every chunk on identical
    # conditioning, which is also one less source of drift across a clip.
    prep_kwargs = {}
    exag = base_kwargs.get("exaggeration")
    if exag is not None:
        prep_kwargs["exaggeration"] = exag
    if args.model in CUE_MODELS:
        prep_kwargs["norm_loudness"] = args.norm_loudness
        base_kwargs.pop("norm_loudness", None)
    model.prepare_conditionals(str(reference_wav), **prep_kwargs)

    def render(seed: int | None) -> "torch.Tensor":
        if seed is not None:
            torch.manual_seed(seed)
        tracks = []
        for seg_text, pause_after in split_pauses(text):
            pieces = (chunk_text(seg_text, args.chunk_size)
                      if args.chunk and len(seg_text) > args.chunk_size else [seg_text])
            if len(pieces) > 1:
                print(f"chunking into {len(pieces)} pieces (target <= {args.chunk_size} chars)",
                      file=sys.stderr)
            for i, piece in enumerate(pieces, 1):
                preview = piece[:60].replace("\n", " ")
                print(f"  [{i}/{len(pieces)}] ({len(piece)} chars) {preview}...", file=sys.stderr)
                wav = model.generate(piece, **base_kwargs)
                if wav.dim() == 1:
                    wav = wav.unsqueeze(0)
                tracks.append(wav)
                if i < len(pieces):
                    tracks.append(torch.zeros(1, int(sr * args.chunk_silence)))
            if pause_after > 0:
                tracks.append(torch.zeros(1, int(sr * pause_after)))
        return torch.cat(tracks, dim=-1) if len(tracks) > 1 else tracks[0]

    print(f"loaded chatterbox {args.model}"
          f"{'/' + args.mtl_version if args.model == 'multilingual' else ''} "
          f"on device={device}", file=sys.stderr)

    if args.candidates > 1:
        # Pronunciation is a sampling lottery — "record" the noun and "record"
        # the verb come out of the same tokens. Rendering N seeded takes and
        # keeping the one that is right is faster than fighting the text, and
        # the seed makes the winner reproducible.
        base_seed = args.seed if args.seed is not None else 0
        written = []
        for k in range(args.candidates):
            seed = base_seed + k
            combined = render(seed)
            p = out_path.with_name(f"{out_path.stem}.seed{seed}{out_path.suffix}")
            torchaudio.save(str(p), combined, sr)
            written.append((seed, p))
            print(f"  -> seed {seed}: {p}", file=sys.stderr)
        # First candidate also lands at the requested path so callers that
        # expect exactly --out still get a file there.
        shutil.copy2(written[0][1], out_path)
        print(str(out_path))
        for seed, p in written:
            print(f"seed={seed}\t{p}")
        return

    combined = render(args.seed)
    torchaudio.save(str(out_path), combined, sr)
    print(str(out_path))


def cmd_list(args):
    if not PROFILE_ROOT.is_dir():
        print("(no profiles)")
        return
    entries = sorted(p for p in PROFILE_ROOT.iterdir() if p.is_dir())
    if not entries:
        print("(no profiles)")
        return
    for p in entries:
        meta = p / "profile.json"
        duration = "?"
        created = "?"
        if meta.is_file():
            try:
                j = json.loads(meta.read_text())
                duration = f"{j.get('reference_duration_sec', '?')}s"
                created = j.get("created_at", "?")
            except json.JSONDecodeError:
                pass
        print(f"{p.name:24s}  {duration:>8s}  {created}")


def cmd_show(args):
    validate_name(args.profile)
    pdir = profile_dir(args.profile)
    if not pdir.is_dir():
        fail(f"profile '{args.profile}' not found")
    meta = pdir / "profile.json"
    if meta.is_file():
        print(meta.read_text(), end="")
    else:
        print(json.dumps({"name": args.profile, "path": str(pdir)}, indent=2))


def cmd_delete(args):
    validate_name(args.profile)
    pdir = profile_dir(args.profile)
    if not pdir.is_dir():
        fail(f"profile '{args.profile}' not found")
    if not args.force:
        fail(f"refusing to delete '{args.profile}' without --force")
    shutil.rmtree(pdir)
    print(f"deleted profile '{args.profile}'")


def cmd_tags(args):
    print("Cue tags (turbo and nano only — every other model reads them aloud):")
    for t in sorted(CUE_TAGS):
        print(f"  {t}")
    print()
    print("Handled by this CLI on every model, by inserting real silence:")
    print(f"  [pause]        {DEFAULT_PAUSE_SEC}s")
    print("  [pause:1.5]    1.5s")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="chatterbox", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True, metavar="<command>")

    p_clone = sub.add_parser("clone", help="Save a voice profile from audio samples")
    p_clone.add_argument("--name", required=True)
    p_clone.add_argument("--sample", required=True, action="append",
                         help="Path to audio sample; repeat for multiple (all are concatenated)")
    p_clone.add_argument("--force", action="store_true")
    p_clone.add_argument("--notes", default="")
    p_clone.add_argument("--seconds", type=int, default=REFERENCE_SECONDS,
                         help=f"Reference length (default {REFERENCE_SECONDS}); the speaker "
                              f"encoder reads all of it, the prompt slices cap at 15s")
    p_clone.set_defaults(func=cmd_clone)

    p_rebuild = sub.add_parser("rebuild", help="Regenerate reference.wav from stored sources")
    p_rebuild.add_argument("--profile", required=True)
    p_rebuild.add_argument("--seconds", type=int, default=REFERENCE_SECONDS,
                           help=f"Reference length (default {REFERENCE_SECONDS})")
    p_rebuild.set_defaults(func=cmd_rebuild)

    p_tts = sub.add_parser("tts", help="Generate speech from text using a profile")
    p_tts.add_argument("--profile", required=True)
    p_tts.add_argument("--text", required=True, help="Text, or @/path/to/file.txt")
    p_tts.add_argument("--out", required=True)
    p_tts.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    p_tts.add_argument("--model", default="standard",
                       choices=["standard", "turbo", "multilingual", "nano"],
                       help="standard/multilingual = 10-step decoder, best quality, "
                            "exaggeration+cfg_weight. turbo/nano = 2-step, fast, cue tags.")
    p_tts.add_argument("--mtl-version", default="v3", choices=["v2", "v3"], dest="mtl_version",
                       help="Multilingual T3 weights (default v3)")
    p_tts.add_argument("--language", default="en", help="Multilingual only (default en)")
    p_tts.add_argument("--seed", type=int, default=None,
                       help="Make a take reproducible; reroll for a different reading")
    p_tts.add_argument("--candidates", type=int, default=1,
                       help="Render N seeded takes side by side and pick the best")
    p_tts.add_argument("--exaggeration", type=float, default=None,
                       help="standard/multilingual only (0.5 default, 0.7+ dramatic)")
    p_tts.add_argument("--cfg-weight", type=float, default=None, dest="cfg_weight",
                       help="standard/multilingual only; ~0.3 slows the pacing down")
    p_tts.add_argument("--temperature", type=float, default=None, help="turbo/nano only")
    p_tts.add_argument("--top-p", type=float, default=None, dest="top_p", help="turbo/nano only")
    p_tts.add_argument("--repetition-penalty", type=float, default=None,
                       dest="repetition_penalty", help="turbo/nano only")
    p_tts.add_argument("--norm-loudness", dest="norm_loudness", action="store_true", default=True,
                       help="turbo/nano: normalise the reference to -27 LUFS (default on)")
    p_tts.add_argument("--no-norm-loudness", dest="norm_loudness", action="store_false")
    p_tts.add_argument("--chunk", dest="chunk", action="store_true", default=True,
                       help="Auto-chunk long text by paragraph/sentence (default on)")
    p_tts.add_argument("--no-chunk", dest="chunk", action="store_false",
                       help="Disable auto-chunking; send entire text as one generation")
    p_tts.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_MAX_CHARS,
                       dest="chunk_size", help=f"Max chars per chunk (default {DEFAULT_CHUNK_MAX_CHARS})")
    p_tts.add_argument("--chunk-silence", type=float, default=DEFAULT_CHUNK_SILENCE_SEC,
                       dest="chunk_silence",
                       help=f"Seconds of silence between chunks (default {DEFAULT_CHUNK_SILENCE_SEC})")
    p_tts.set_defaults(func=cmd_tts)

    p_list = sub.add_parser("list", help="List saved profiles")
    p_list.set_defaults(func=cmd_list)

    p_show = sub.add_parser("show", help="Show profile metadata")
    p_show.add_argument("--profile", required=True)
    p_show.set_defaults(func=cmd_show)

    p_tags = sub.add_parser("tags", help="List the cue tags each model understands")
    p_tags.set_defaults(func=cmd_tags)

    p_delete = sub.add_parser("delete", help="Delete a profile")
    p_delete.add_argument("--profile", required=True)
    p_delete.add_argument("--force", action="store_true")
    p_delete.set_defaults(func=cmd_delete)

    return parser


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
