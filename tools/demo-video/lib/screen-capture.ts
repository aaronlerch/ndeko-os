/**
 * Record the browser's page area by capturing the screen with ffmpeg and
 * cropping to it — the interceptor engine's fallback when interceptor-bridge,
 * and with it `capture record`, is not installed.
 *
 * ## What it costs, compared with the bridge
 *
 * The bridge records one WINDOW through ScreenCaptureKit, so you can keep
 * working in front of it. This records the SCREEN, so the browser window has
 * to be frontmost and unobstructed for the whole take: anything that lands on
 * top of it — a notification banner, a permission dialog — is on the tape.
 * Look at the frames before trusting a take.
 *
 * It needs Screen Recording for whatever launched the run (the terminal, by
 * macOS's responsible-process rule), not a grant for a separate app. That is
 * the reason it exists: no bridge build, no new grant, no ad-hoc signature
 * whose code hash voids the grant on the next rebuild.
 *
 * ## The first-frame clock
 *
 * `Engine.start` must report the wall clock of the first recorded frame.
 * ffmpeg does not announce it, and its avfoundation input takes a variable
 * moment to deliver one. So it is measured after the fact instead: when the
 * capture stops, the tape's duration subtracted from the stop time IS the first
 * frame's clock, exactly — the mp4 muxer keeps wall-clock timing by
 * duplicating or dropping frames to hold the output rate.
 */
import type { Subprocess } from "bun";
import { probeDuration } from "./tts";

/** A crop rectangle in screen PIXELS (points × backing scale). */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenCapture {
  /** Epoch ms when ffmpeg was spawned — a lower bound on the first frame. */
  spawnedMs: number;
  /** Stop, finalise the file, and report the first frame's real clock. */
  stop(): Promise<{ path: string; firstFrameMs: number }>;
  /** Best-effort stop after a failure. */
  abort(): Promise<void>;
}

/**
 * Does `interceptor macos capture record` exist on this install? A
 * browser-only install answers with "not available"; an old bridge with
 * "notImplemented". Either way the answer is the fallback.
 */
export function bridgeCanCapture(): boolean {
  const probe = Bun.spawnSync([
    "interceptor",
    "macos",
    "capture",
    "record",
    "status",
    "--json",
  ]);
  const out = probe.stdout.toString() + probe.stderr.toString();
  return (
    probe.exitCode === 0 && !/not available|notImplemented|unknown/i.test(out)
  );
}

/** Index of the avfoundation device for the main display, or null. */
export function screenDevice(): string | null {
  const probe = Bun.spawnSync([
    "ffmpeg",
    "-hide_banner",
    "-f",
    "avfoundation",
    "-list_devices",
    "true",
    "-i",
    "",
  ]);
  const listing = probe.stderr.toString();
  const m = listing.match(/\[(\d+)\] Capture screen 0/);
  return m ? (m[1] as string) : null;
}

/** Round down to an even number — libx264 with yuv420p rejects odd sizes. */
const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

export async function startScreenCapture(opts: {
  out: string;
  crop: PixelRect;
  /** Output width; height follows the crop's aspect. */
  outWidth: number;
}): Promise<ScreenCapture> {
  const device = screenDevice();
  if (device === null) {
    throw new Error(
      `ffmpeg cannot see a screen to capture (no "Capture screen 0" device).
  The terminal running this needs Screen Recording in System Settings →
  Privacy & Security, and the screen must be awake and unlocked.`,
    );
  }
  const c = {
    x: Math.max(0, Math.round(opts.crop.x)),
    y: Math.max(0, Math.round(opts.crop.y)),
    w: even(opts.crop.width),
    h: even(opts.crop.height),
  };
  const outW = even(opts.outWidth);
  const outH = even((c.h / c.w) * outW);

  const spawnedMs = Date.now();
  const proc: Subprocess<"pipe", "ignore", "pipe"> = Bun.spawn(
    [
      "ffmpeg",
      "-hide_banner",
      "-y",
      "-f",
      "avfoundation",
      // The engine draws its own pointer into the page. The real cursor —
      // parked wherever the operator left it — would be a second one.
      "-capture_cursor",
      "0",
      "-framerate",
      "30",
      "-i",
      `${device}:none`,
      "-vf",
      `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${outW}:${outH}:flags=lanczos`,
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      opts.out,
    ],
    { stdin: "pipe", stdout: "ignore", stderr: "pipe" },
  );

  // Collect stderr as it arrives: it is the only place a failure says why,
  // and an unread pipe can fill and stall the encoder.
  let log = "";
  const reader = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr) log += decoder.decode(chunk);
  })();

  // Block until frames are actually flowing, so the walk never starts on a
  // capture that is still opening (or has already died).
  const deadline = Date.now() + 15_000;
  while (!/frame=\s*\d+/.test(log)) {
    if (proc.exitCode !== null) {
      throw new Error(`ffmpeg screen capture exited:\n${log.slice(-1500)}`);
    }
    if (Date.now() > deadline) {
      proc.kill();
      throw new Error(
        `ffmpeg screen capture produced no frames in 15s:\n${log.slice(-1500)}`,
      );
    }
    await Bun.sleep(100);
  }

  const finish = async () => {
    // `q` on stdin is ffmpeg's clean stop: it flushes the encoder and writes
    // the moov atom. A signal can leave an unplayable file.
    proc.stdin.write("q");
    await proc.stdin.end();
    const timer = setTimeout(() => proc.kill(), 20_000);
    await proc.exited;
    clearTimeout(timer);
    await reader;
  };

  return {
    spawnedMs,
    async stop() {
      const stoppedMs = Date.now();
      await finish();
      if (proc.exitCode !== 0) {
        throw new Error(
          `ffmpeg screen capture failed (${proc.exitCode}):\n${log.slice(-1500)}`,
        );
      }
      const duration = await probeDuration(opts.out);
      return { path: opts.out, firstFrameMs: stoppedMs - duration * 1000 };
    },
    async abort() {
      await finish().catch(() => proc.kill());
    },
  };
}
