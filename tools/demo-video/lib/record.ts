/**
 * The storyboard interpreter: drives one take and records it.
 *
 * The sync contract, which everything downstream depends on:
 *
 *   A segment records the wall-clock offset at which it STARTED, runs its
 *   actions, then holds the screen until the narration clip's measured length
 *   plus a pad has elapsed.
 *
 * The marks are observed, never planned. A segment whose actions finish early
 * holds its last screen; one that overruns a slow route transition simply pushes
 * every later beat along with it, and the audio still lands where the screen is.
 * Planning offsets up front desyncs on the first slow page load.
 *
 * Everything browser-specific lives behind `Engine` (see engine.ts). This file
 * owns the clock and nothing else, so both engines produce a recording the
 * assembler cannot tell apart.
 */
import type { Engine } from "./engine";
import { InterceptorEngine } from "./engine-interceptor";
import { PlaywrightEngine } from "./engine-playwright";
import { DEFAULTS, type Storyboard, type Take } from "./storyboard";
import type { Timing } from "./tts";

export interface Mark {
  id: string;
  t: number;
}

export interface TakeRecording {
  profile?: string;
  /** Saved session this take was recorded under, if any. */
  session?: string;
  /** Which engine produced it — recorded so a mixed-engine demo is legible. */
  engine?: string;
  videoPath: string;
  total: number;
  marks: Mark[];
  /** Seconds of tape recorded BEFORE the walk's clock started — page
   *  creation, cursor install, and the pre-navigation to the first
   *  destination. The assembler trims this off the head of the take, which
   *  both removes the blank-white opening frames and keeps the marks (which
   *  are relative to the clock, not the tape) aligned with the trimmed video. */
  head: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeEngine(name: string): Engine {
  switch (name) {
    case "playwright":
      return new PlaywrightEngine();
    case "interceptor":
      return new InterceptorEngine();
    default:
      throw new Error(
        `unknown engine "${name}". Known: playwright, interceptor`,
      );
  }
}

export async function recordTake(
  sb: Storyboard,
  take: Take,
  timings: Timing[],
  videoDir: string,
  /** Playwright storageState for `take.session`, already loaded and checked by
   *  the runner. Absent means record signed-out. */
  storageState?: unknown,
  /** Resolved by the runner so the precedence — `--engine` over take over
   *  storyboard over default — lives in one visible place. */
  engineName?: string,
): Promise<TakeRecording> {
  const baseUrl = sb.baseUrl ?? DEFAULTS.baseUrl;
  const viewport = sb.viewport ?? DEFAULTS.viewport;
  const pad = sb.pad ?? DEFAULTS.pad;
  const seconds = new Map(timings.map((t) => [t.id, t.seconds]));

  const engine = makeEngine(
    engineName ?? take.engine ?? sb.engine ?? DEFAULTS.engine,
  );

  // When the take's very first action is a `goto` it is consumed by the
  // engine's pre-navigation rather than replayed (a same-URL `goto` in the
  // loop would be a full reload — a white flash reintroduced); any other
  // opening action pre-navigates to the base URL and the actions run untouched.
  const firstAction = take.segments[0]?.do?.[0];
  const hoistFirstGoto = firstAction !== undefined && "goto" in firstAction;
  const firstUrl = hoistFirstGoto
    ? new URL(firstAction.goto, baseUrl).toString()
    : baseUrl;

  const { recStartMs, describe } = await engine.start({
    firstUrl,
    viewport,
    videoDir,
    cursor: sb.cursor ?? DEFAULTS.cursor,
    hideDevOverlay: sb.hideDevOverlay ?? DEFAULTS.hideDevOverlay,
    storageState,
    allowCspStrip: take.allowCspStrip === true,
  });
  if (take.allowCspStrip === true) {
    console.log(
      `  csp      STRIPPED for this host+tab — the site runs without its own
           XSS defenses while this take records. Opted in by the storyboard.`,
    );
  }
  console.log(`  engine   ${engine.name} — ${describe}`);

  const t0 = Date.now();
  const head = (t0 - recStartMs) / 1000;
  const marks: Mark[] = [];

  try {
    for (const [si, segment] of take.segments.entries()) {
      const started = Date.now();
      const at = (started - t0) / 1000;
      marks.push({ id: segment.id, t: at });
      console.log(`  [${at.toFixed(1)}s] ${segment.id}`);

      const actions = segment.do ?? [];
      for (const action of hoistFirstGoto && si === 0
        ? actions.slice(1)
        : actions) {
        await engine.perform(action, baseUrl);
      }

      const hold = (seconds.get(segment.id) ?? 3) + pad;
      const remaining = hold * 1000 - (Date.now() - started);
      if (remaining > 0) await sleep(remaining);
    }
  } catch (e) {
    // Tear down anyway so the partial video is written and can be inspected —
    // a failed walk is usually diagnosable from its last frame.
    const { videoPath } = await engine.abort().catch(() => ({
      videoPath: undefined,
    }));
    throw new Error(
      `${(e as Error).message}\n  partial recording: ${videoPath ?? "(none)"}`,
    );
  }

  const total = (Date.now() - t0) / 1000;
  const { videoPath } = await engine.stop();

  return {
    profile: take.profile,
    session: take.session,
    engine: engine.name,
    videoPath,
    total,
    marks,
    head,
  };
}
