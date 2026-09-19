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
 *
 * The same loop also runs the DRY RUN (`dryRunTake`): every action performs
 * for real against the live app, but nothing is narrated, nothing is taped, and
 * no screen is held. It exists because a storyboard's failures are almost all
 * target failures — an ambiguous name, a slot that moved, a sticky footer over
 * a radio — and each one used to cost a full narrated take to discover.
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

/** What a dry run learned about one segment. */
export interface SegmentTiming {
  id: string;
  /** Seconds the segment's actions took, waits included (capped, see below). */
  actionSeconds: number;
}

export interface DryRunReport {
  engine: string;
  total: number;
  segments: SegmentTiming[];
}

/**
 * Longest `wait` a dry run honours. A storyboard's waits are two different
 * things wearing one verb: a short settle after a scroll so the click does
 * not race the easing (0.4–0.7s, load-bearing), and a viewing pause so the
 * audience can read the screen (2–3.5s, pacing). The dry run keeps every
 * settle intact and clips the pacing, which is most of the wall clock.
 */
export const DRY_RUN_WAIT_CAP_S = 1;

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

interface WalkOptions {
  sb: Storyboard;
  take: Take;
  engine: Engine;
  videoDir: string;
  storageState?: unknown;
  /** Absent means dry: no holds, waits capped. */
  timings?: Timing[];
  /** Where the dry run drops a frame of the failing state. */
  failureShot?: string;
}

interface WalkResult {
  head: number;
  total: number;
  marks: Mark[];
  segments: SegmentTiming[];
}

async function walk(opts: WalkOptions): Promise<WalkResult> {
  const { sb, take, engine } = opts;
  const dry = opts.timings === undefined;
  const baseUrl = sb.baseUrl ?? DEFAULTS.baseUrl;
  const viewport = sb.viewport ?? DEFAULTS.viewport;
  const pad = sb.pad ?? DEFAULTS.pad;
  const seconds = new Map((opts.timings ?? []).map((t) => [t.id, t.seconds]));

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
    videoDir: opts.videoDir,
    cursor: sb.cursor ?? DEFAULTS.cursor,
    hideDevOverlay: sb.hideDevOverlay ?? DEFAULTS.hideDevOverlay,
    storageState: opts.storageState,
    allowCspStrip: take.allowCspStrip === true,
    record: !dry,
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
  const segments: SegmentTiming[] = [];

  let current = "(before the first segment)";
  let step = "";
  try {
    for (const [si, segment] of take.segments.entries()) {
      current = segment.id;
      const started = Date.now();
      const at = (started - t0) / 1000;
      marks.push({ id: segment.id, t: at });
      console.log(`  [${at.toFixed(1)}s] ${segment.id}`);

      const actions = segment.do ?? [];
      const toRun = hoistFirstGoto && si === 0 ? actions.slice(1) : actions;
      for (const [ai, action] of toRun.entries()) {
        step = `do[${ai + (hoistFirstGoto && si === 0 ? 1 : 0)}] ${JSON.stringify(action)}`;
        if (dry && "wait" in action) {
          await sleep(Math.min(action.wait, DRY_RUN_WAIT_CAP_S) * 1000);
          continue;
        }
        await engine.perform(action, baseUrl);
      }
      const actionSeconds = (Date.now() - started) / 1000;
      segments.push({ id: segment.id, actionSeconds });

      if (dry) continue;
      const hold = (seconds.get(segment.id) ?? 3) + pad;
      const remaining = hold * 1000 - (Date.now() - started);
      if (remaining > 0) await sleep(remaining);
    }
  } catch (e) {
    // Say WHERE before saying what: the Playwright message names the target,
    // and the segment id plus the action index is what the author edits.
    const where = `${current}  ${step}`;
    let shot = "";
    if (opts.failureShot && engine.snapshot) {
      await engine
        .snapshot(opts.failureShot)
        .then(() => {
          shot = `\n  failing screen: ${opts.failureShot}`;
        })
        .catch(() => {});
    }
    // Tear down anyway so the partial video is written and can be inspected —
    // a failed walk is usually diagnosable from its last frame.
    const { videoPath } = await engine.abort().catch(() => ({
      videoPath: undefined,
    }));
    const tape = dry ? "" : `\n  partial recording: ${videoPath ?? "(none)"}`;
    throw new Error(`${where}\n  ${(e as Error).message}${shot}${tape}`);
  }

  return { head, total: (Date.now() - t0) / 1000, marks, segments };
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
  const engine = makeEngine(
    engineName ?? take.engine ?? sb.engine ?? DEFAULTS.engine,
  );
  const { head, total, marks } = await walk({
    sb,
    take,
    engine,
    videoDir,
    storageState,
    timings,
  });
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

/**
 * Walk a take without narrating, taping or holding. Always the Playwright
 * engine: it is headless, it is the only engine whose strict mode names every
 * element an ambiguous target matched, and the failures a dry run exists to
 * find are properties of the storyboard and the page, not of the engine.
 */
export async function dryRunTake(
  sb: Storyboard,
  take: Take,
  /** Where to drop `dry-run-failure.png` if an action fails. */
  outDir: string,
  storageState?: unknown,
): Promise<DryRunReport> {
  const engine = makeEngine("playwright");
  const { total, segments } = await walk({
    sb,
    take,
    engine,
    videoDir: outDir,
    storageState,
    failureShot: `${outDir}/dry-run-failure.png`,
  });
  await engine.abort();
  return { engine: engine.name, total, segments };
}
