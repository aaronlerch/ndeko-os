/**
 * The storyboard is the whole demo. Narration and actions live in one file so
 * a new demo is data, not a bespoke Playwright script.
 *
 * Committed under docs/demos/. The rendered mp4 is a build artifact; this is
 * the source, and a storyboard that stops working is telling you the demo has
 * gone stale.
 */

import type { EngineName } from "./engine";

/** One instruction inside a segment. Exactly one verb key per object. */
export type Action =
  /** Navigate. Relative paths resolve against `baseUrl`. */
  | { goto: string }
  /** Move the pointer to a target and click it. */
  | { click: string }
  /** Move the pointer onto a target without clicking. */
  | { hover: string }
  /** Click into a field and type at a readable cadence. */
  | { type: string; text: string; delay?: number }
  /** Press a key (Playwright key syntax, e.g. "Enter", "Control+A"). */
  | { press: string }
  /**
   * Scroll the container at this target by `by` pixels, eased. Negative scrolls
   * up. If the target is not itself scrollable, its nearest scrollable ancestor
   * moves. `ms` overrides the distance-derived duration.
   */
  | { scroll: string; by: number; ms?: number }
  /**
   * Scroll a target into view, eased — the readable form when you know WHAT you
   * want on screen rather than how many pixels away it is.
   *
   * `onlyIfNeeded` leaves an already-visible target alone; without it the target
   * is always brought to a consistent position near the top, which is what you
   * want when the shot needs to land the same way every take.
   */
  | { scrollTo: string; onlyIfNeeded?: boolean; ms?: number }
  /** Block until the URL matches this regular expression source. */
  | { awaitUrl: string }
  /** Block until this target is visible. */
  | { awaitText: string }
  /** Hold still for N seconds. */
  | { wait: number };

/** A narration beat plus whatever happens on screen while it plays. */
export interface Segment {
  /** Stable id — names the audio clip and joins narration to marks. */
  id: string;
  /** What the voice says. Empty string records a silent beat. */
  say: string;
  /** Actions performed during the beat. */
  do?: Action[];
}

/**
 * A check that must pass before recording starts.
 *
 * The first phase-2 cut narrated "including the two new CRM fields" over a page
 * that had none: the words were right and the database was not. Assert every
 * fact the narration promises, so a stale-data recording fails loudly instead
 * of quietly wasting a take.
 */
export type Check =
  | {
      /** Read-only SQL against DATABASE_URL. Always parameterized. */
      sql: string;
      params?: (string | number | boolean | null)[];
      /** Compared against the first column of the first row. */
      expect: {
        gte?: number;
        eq?: string | number | boolean | null;
        notNull?: true;
      };
      /** Why this matters — printed when it fails. */
      because: string;
    }
  | {
      /** Fetch a path and require this text in the response body. */
      url: string;
      expectText: string;
      because: string;
    };

/**
 * One continuous recording.
 *
 * `profile` names the signed-in identity this take expects the app to be
 * running as; `product.ts` turns it into that product's own restart
 * instruction. It exists
 * because profiles are restart-only: two `next dev` processes in one app
 * directory clobber each other's `.next`, so a demo spanning the customer and
 * operator surfaces is two takes stitched at assembly time, not one walk.
 *
 * It is optional, and omitting it is the right thing for a demo whose subject
 * is not this app — a public site, a vendor flow — where there is no dev stack
 * to restart and the runner should not tell you to restart one.
 */
export interface Take {
  /** Auth profile this take expects. Omit for a demo of any
   *  target that is not the local dev stack. */
  profile?: string;
  /**
   * Name of a saved browser session to record this take under — see
   * `bun run demo:login`. This is how a demo walks a site that requires a
   * sign-in; the local dev stack uses `profile` instead.
   */
  session?: string;
  /** Override the storyboard's engine for this take. */
  engine?: EngineName;
  /**
   * Let the engine strip this page's Content-Security-Policy.
   *
   * Only the `interceptor` engine has anything to strip, and it only needs to
   * on a site whose CSP forbids `unsafe-eval` — which blocks the target
   * resolver in both the main and isolated worlds, so the walk cannot run at
   * all. The cost is real: for the life of one tab on one host, a site you are
   * signed into runs without its own XSS defenses. It lives in the committed
   * storyboard, not a CLI flag, so the decision stays attached to the demo that
   * made it.
   */
  allowCspStrip?: boolean;
  /** Human note shown when the runner asks you to switch stacks. */
  note?: string;
  preflight?: Check[];
  segments: Segment[];
}

export interface Storyboard {
  $schema?: string;
  /** Slug — names the output directory and the mp4. */
  name: string;
  /** Human title, for the manifest. */
  title: string;
  baseUrl?: string;
  /**
   * What drives the browser. `playwright` (the default) is headless Chromium
   * with a fresh context; `interceptor` records your own signed-in Chrome as a
   * window and is macOS-only. See lib/engine-interceptor.ts for the trade.
   */
  engine?: EngineName;
  viewport?: { width: number; height: number };
  /** Named voice profile from the local voice config. See lib/voice.ts. */
  voice?: string;
  /** Seconds of silence held after each narration clip. */
  pad?: number;
  /** Draw a synthetic pointer. On by default. */
  cursor?: boolean;
  /** Hide framework dev overlays in the recording. On by default. */
  hideDevOverlay?: boolean;
  /**
   * Statements run by `--reset` to return the demo data to its pre-walk state.
   * Parameterized, same rules as a Check.
   */
  reset?: { sql: string; params?: (string | number | boolean | null)[] }[];
  takes: Take[];
}

export const DEFAULTS = {
  baseUrl: "http://localhost:3001",
  engine: "playwright" as EngineName,
  viewport: { width: 1440, height: 900 },
  pad: 1.2,
  cursor: true,
  hideDevOverlay: true,
} as const;

const VERBS = [
  "goto",
  "click",
  "hover",
  "type",
  "press",
  "scroll",
  "scrollTo",
  "awaitUrl",
  "awaitText",
  "wait",
];

/** Load and validate. Throws with a path to the offending node. */
export async function loadStoryboard(path: string): Promise<Storyboard> {
  const raw = await Bun.file(path).text();
  let sb: Storyboard;
  try {
    sb = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path}: not valid JSON — ${(e as Error).message}`);
  }
  const bad = (where: string, why: string) => {
    throw new Error(`${path} → ${where}: ${why}`);
  };

  if (!sb.name || !/^[a-z0-9][a-z0-9-]*$/.test(sb.name)) {
    bad("name", "required, lowercase kebab-case (it names the output files)");
  }
  if (!sb.title) bad("title", "required");
  if (!Array.isArray(sb.takes) || sb.takes.length === 0) {
    bad("takes", "at least one take is required");
  }

  const ids = new Set<string>();
  sb.takes.forEach((take, ti) => {
    if (!Array.isArray(take.segments) || take.segments.length === 0) {
      bad(`takes[${ti}].segments`, "at least one segment is required");
    }
    if (
      take.engine !== undefined &&
      take.engine !== "playwright" &&
      take.engine !== "interceptor"
    ) {
      bad(`takes[${ti}].engine`, 'must be "playwright" or "interceptor"');
    }
    if (
      take.session !== undefined &&
      !/^[a-z0-9][a-z0-9-]*$/.test(take.session)
    ) {
      bad(
        `takes[${ti}].session`,
        "must be lowercase kebab-case — it names a file in the sessions dir",
      );
    }
    take.segments.forEach((seg, si) => {
      const at = `takes[${ti}].segments[${si}]`;
      if (!seg.id) bad(at, "id is required");
      if (ids.has(seg.id)) {
        bad(at, `duplicate id "${seg.id}" — ids key the audio clips`);
      }
      ids.add(seg.id);
      if (typeof seg.say !== "string") bad(at, "say must be a string");
      for (const [ai, action] of (seg.do ?? []).entries()) {
        const verbs = Object.keys(action).filter((k) => VERBS.includes(k));
        if (verbs.length !== 1) {
          bad(
            `${at}.do[${ai}]`,
            `exactly one verb per action, found [${verbs.join(", ")}]. ` +
              `Known verbs: ${VERBS.join(", ")}`,
          );
        }
        // `scroll` without `by` used to validate, record, and scroll nothing —
        // a wasted take whose only symptom was a shot that did not move.
        const args = action as { by?: unknown; ms?: unknown };
        if (verbs[0] === "scroll" && typeof args.by !== "number") {
          bad(
            `${at}.do[${ai}]`,
            "`scroll` needs a numeric `by` (pixels; negative scrolls up). " +
              "To bring something on screen instead, use `scrollTo`.",
          );
        }
        if (
          args.ms !== undefined &&
          (typeof args.ms !== "number" || args.ms <= 0)
        ) {
          bad(`${at}.do[${ai}]`, "`ms` must be a positive number");
        }
      }
    });
  });

  return sb;
}

/** Every segment across every take, in recording order. */
export function allSegments(sb: Storyboard): Segment[] {
  return sb.takes.flatMap((t) => t.segments);
}
