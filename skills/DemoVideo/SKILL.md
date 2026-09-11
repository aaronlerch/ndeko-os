---
name: demo-video
description: Record a narrated demo video of a website or a feature by driving a real browser and synthesising voiceover. Authors a storyboard, runs the pipeline, verifies the result by looking at frames. USE WHEN demo video, record a demo, show off this feature, walkthrough video, screen recording with narration, narrated demo, record the app, demo this, make a video of. NOT FOR editing an existing video file, and NOT FOR a screenshot (that is Interceptor).
argument-hint: "[what to demo] | install"
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# /demo-video

Produce a narrated mp4 that shows something working, by driving a real browser
and laying synthesised narration onto the recording.

Arguments: `$ARGUMENTS`

## Step 0 — which install is this? Do this before anything else.

There are two installs of this pipeline and they are not interchangeable. A
project that carries its own is the authority inside itself: it knows that
product's storyboards, its auth profiles, its data resets, and where its videos
get published.

```bash
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] && [ -f "$ROOT/.claude/skills/demo-video/SKILL.md" ] && echo "PROJECT: $ROOT"
```

**If that prints a path, read `$ROOT/.claude/skills/demo-video/SKILL.md` and
follow it instead of the rest of this file. Stop here.** Personal skills take
precedence over project ones, so this file is what gets invoked inside such a
repo — and that precedence is backwards for this tool. Delegating is how the
project's own skill wins anyway.

Everything below applies only when there is no project install.

## The generic pipeline

Machine-global, at `~/.claude/tools/demo-video/`, on PATH as `demo-video`.

```bash
demo-video doctor                    # what is ready, what is not
demo-video record <storyboard>       # narrate, drive, assemble
demo-video login <name> --url <u>    # once, for a site behind a sign-in
```

Storyboards live in `${XDG_CONFIG_HOME:-~/.config}/demo-video/storyboards/<name>.json`
and render to `${XDG_CONFIG_HOME:-~/.config}/demo-video/out/<name>/`. Read
`~/.claude/tools/demo-video/README.md` for the storyboard format, the target
grammar, and the engine trade-offs before authoring one.

## `install` — walk the setup

When `$ARGUMENTS` is `install`, or the person says nothing is set up:

1. Run `demo-video doctor`. It probes and names the fix for each gap; do not
   recite a checklist from memory.
2. Walk the failures in the order printed, and **offer to run each fix rather
   than pasting a command to type**. `demo-video deps` prompts before anything
   needing `sudo`, so the decision stays with them.
3. **Do not skip past a voice warning.** It is the only prerequisite that fails
   silently — with no voice configured the pipeline renders the entire demo in
   the OS synthesiser and exits zero, and someone setting this up for the first
   time has no way to know that is not how it is meant to sound. Say plainly
   that it will sound like a robot until a voice is configured.
4. Re-run the doctor at the end and show the result.

## What done looks like

- A storyboard that renders the demo from nothing but its own contents.
- An mp4 whose narration matches what is on screen, **verified by looking at
  extracted frames** — not by the pipeline exiting zero.
- Every claim the narration makes covered by a `preflight` check, so the same
  demo cannot be re-recorded against stale data.

## Constraints

**Never claim the video is good without watching it.** A green exit means
ffmpeg succeeded, not that the demo shows the thing. Extract a frame at each
moment the narration makes a specific claim and read it:

```bash
ffmpeg -v error -ss <seconds> -i <out.mp4> -frames:v 1 -y /tmp/frame.png
```

`out/<name>/marks-*.json` gives the offsets. If a segment says "and the total
updates", the frame at that mark must show it.

**The default engine is the right one.** `playwright` is headless, so a
recording does not occupy the machine. Reach for `--engine interceptor` only
when the demo genuinely needs the real signed-in browser — a site that
challenges automation, or one whose auth cannot live in a throwaway profile —
and say so, because it records a real window in a real profile and every click
is a real click.

**Write the narration first, and keep each clip under about twelve seconds.**
The walk holds each screen for at least as long as its clip, so a long sentence
buys a long static hold. Then attach the actions that happen while it plays.

**Expect the first take to fail on a selector.** That is the storyboard doing
its job. Recording is cheap, and a walk clicks faster than a human, so read the
run's log: retries and bounces in it are usually real races, not flakes.

## Publishing

This install has nowhere to publish to — the mp4 is on disk and that is the
deliverable. Sending it anywhere is an outbound action: report the path and ask.
