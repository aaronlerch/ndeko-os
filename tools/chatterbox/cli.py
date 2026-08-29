#!/usr/bin/env python3
"""
Chatterbox CLI wrapper — voice profile management and TTS generation.

Subcommands:
  clone  --name <n> --sample <path>... [--force] [--notes <text>]
  tts    --profile <n> --text <str|@file> --out <path>
         [--device auto|cpu|mps|cuda] [--exaggeration <f>] [--cfg-weight <f>]
  list
  show   --profile <n>
  delete --profile <n> --force
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
REFERENCE_SECONDS = 10
REFERENCE_SAMPLE_RATE = 24000
NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
# Chatterbox degrades on long single-shot inputs — empirically, ~300 chars is
# the reliable ceiling. Auto-chunking splits longer text by paragraph then
# sentence, generates each chunk with the same model load, concats the tensors.
DEFAULT_CHUNK_MAX_CHARS = 300
DEFAULT_CHUNK_SILENCE_SEC = 0.35
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


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
    return "cpu"


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

    if not shutil.which("ffmpeg"):
        shutil.rmtree(pdir, ignore_errors=True)
        fail("ffmpeg not installed — needed to normalize reference audio")

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

    source = local_samples[0]
    reference_wav = pdir / "reference.wav"
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-y", "-i", str(source),
        "-t", str(REFERENCE_SECONDS),
        "-ac", "1",
        "-ar", str(REFERENCE_SAMPLE_RATE),
        "-sample_fmt", "s16",
        str(reference_wav),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        shutil.rmtree(pdir, ignore_errors=True)
        fail(f"ffmpeg failed: {e.stderr.strip() or e.stdout.strip()}")

    duration = None
    if shutil.which("ffprobe"):
        try:
            out = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(reference_wav)],
                check=True, capture_output=True, text=True,
            ).stdout.strip()
            duration = round(float(out), 2) if out else None
        except (subprocess.CalledProcessError, ValueError):
            pass

    profile = {
        "name": args.name,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_samples": [str(s.relative_to(pdir)) for s in local_samples],
        "original_source_paths": [str(s) for s in samples],
        "reference_duration_sec": duration,
        "defaults": {"exaggeration": 0.5, "cfg_weight": 0.5},
        "notes": args.notes or "",
    }
    (pdir / "profile.json").write_text(json.dumps(profile, indent=2) + "\n")

    print(f"saved profile '{args.name}' at {pdir}")
    if duration is not None:
        print(f"reference duration: {duration}s")


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

    text = read_text_arg(args.text).strip()
    if not text:
        fail("text is empty")

    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    device = detect_device(args.device)

    try:
        import torch
        import torchaudio
        if args.model == "turbo":
            from chatterbox.tts_turbo import ChatterboxTurboTTS as ModelCls
        else:
            from chatterbox.tts import ChatterboxTTS as ModelCls
    except ImportError as e:
        fail(f"chatterbox-tts not installed: {e} — run setup.sh")

    print(f"loading chatterbox {args.model} model on device={device}...", file=sys.stderr)
    model = ModelCls.from_pretrained(device=device)
    sr = getattr(model, "sr", None) or getattr(model, "sample_rate", 24000)

    gen_kwargs = {"audio_prompt_path": str(reference_wav)}
    if args.model == "standard":
        # exaggeration and cfg_weight apply only to the standard model;
        # Turbo logs a warning if you pass them.
        exaggeration = args.exaggeration if args.exaggeration is not None else defaults.get("exaggeration")
        cfg_weight = args.cfg_weight if args.cfg_weight is not None else defaults.get("cfg_weight")
        if exaggeration is not None:
            gen_kwargs["exaggeration"] = float(exaggeration)
        if cfg_weight is not None:
            gen_kwargs["cfg_weight"] = float(cfg_weight)
    else:
        # Turbo-specific sampling knobs. All optional; model uses its own defaults.
        if args.temperature is not None:
            gen_kwargs["temperature"] = float(args.temperature)
        if args.top_p is not None:
            gen_kwargs["top_p"] = float(args.top_p)
        if args.repetition_penalty is not None:
            gen_kwargs["repetition_penalty"] = float(args.repetition_penalty)

    # Auto-chunk long inputs — Chatterbox garbles on 500+ char single-shot.
    if args.chunk and len(text) > args.chunk_size:
        chunks = chunk_text(text, args.chunk_size)
    else:
        chunks = [text]

    if len(chunks) > 1:
        print(f"chunking into {len(chunks)} pieces (target <= {args.chunk_size} chars)", file=sys.stderr)

    tracks = []
    gap = torch.zeros(1, int(sr * args.chunk_silence))
    for i, chunk in enumerate(chunks, 1):
        if len(chunks) > 1:
            preview = chunk[:60].replace("\n", " ")
            print(f"[{i}/{len(chunks)}] ({len(chunk)} chars) {preview}...", file=sys.stderr)
        else:
            print(f"generating {len(chunk)} chars...", file=sys.stderr)
        wav = model.generate(chunk, **gen_kwargs)
        if wav.dim() == 1:
            wav = wav.unsqueeze(0)
        tracks.append(wav)
        if i < len(chunks):
            tracks.append(gap)

    combined = torch.cat(tracks, dim=-1) if len(tracks) > 1 else tracks[0]
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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="chatterbox", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True, metavar="<command>")

    p_clone = sub.add_parser("clone", help="Save a voice profile from audio samples")
    p_clone.add_argument("--name", required=True)
    p_clone.add_argument("--sample", required=True, action="append",
                         help="Path to audio sample; repeat for multiple")
    p_clone.add_argument("--force", action="store_true")
    p_clone.add_argument("--notes", default="")
    p_clone.set_defaults(func=cmd_clone)

    p_tts = sub.add_parser("tts", help="Generate speech from text using a profile")
    p_tts.add_argument("--profile", required=True)
    p_tts.add_argument("--text", required=True, help="Text, or @/path/to/file.txt")
    p_tts.add_argument("--out", required=True)
    p_tts.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    p_tts.add_argument("--model", default="standard", choices=["standard", "turbo"],
                       help="standard (default) or turbo (supports [laugh] [chuckle] [sigh] tags)")
    p_tts.add_argument("--exaggeration", type=float, default=None)
    p_tts.add_argument("--cfg-weight", type=float, default=None, dest="cfg_weight")
    p_tts.add_argument("--temperature", type=float, default=None, help="Turbo only")
    p_tts.add_argument("--top-p", type=float, default=None, dest="top_p", help="Turbo only")
    p_tts.add_argument("--repetition-penalty", type=float, default=None,
                       dest="repetition_penalty", help="Turbo only")
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
