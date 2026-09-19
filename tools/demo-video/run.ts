#!/usr/bin/env bun
/**
 * Render a narrated demo video from a storyboard.
 *
 *   bun run demo:record property-setup-phase-2
 *   bun run demo:record docs/demos/property-setup-phase-2.json --voice aaron
 *   bun run demo:record <name> --reset
 *   bun run demo:record <name> --take 2
 *   bun run demo:record <name> --assemble-only
 *   bun run demo:record <name> --renarrate
 *   bun run demo:record <name> --narrate-only
 *   bun run demo:record <name> --dry-run
 *   bun run demo:record <name> --out /tmp/demos
 *   bun run demo:record <name> --engine interceptor
 *
 * `--dry-run` walks every action against the live app with no narration, no
 * tape and no holds — about a minute for a three-minute demo — and stops on
 * the first target that cannot be resolved, naming the segment, the action and
 * what Playwright matched, with a PNG of the failing screen. Run it until it
 * is clean, then record. Combine with `--reset` when the walk writes.
 *
 * A take that names a `session` records under a browser session captured by
 * `bun run demo:login` — that is how a demo walks a site behind a sign-in.
 *
 * A storyboard resolves from this product's committed storyboard directory (see
 * `product.ts`) or from the machine-local config dir (demos of anything else —
 * a public site, a vendor flow — which have no business in the product repo).
 * Output follows the storyboard: a config-dir storyboard renders beside itself,
 * not into the checkout. `--out` overrides either.
 *
 * Pipeline: narration first (the walk holds each screen to its clip's measured
 * length), then one recording per auth profile, then one ffmpeg pass that lays
 * every clip onto the stitched timeline at its observed mark.
 *
 * Multi-profile demos are multiple takes on purpose: two `next dev` processes in
 * one app directory clobber each other's `.next`, so switching profiles means
 * restarting the stack, not running a second server.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { assemble } from "./lib/assemble";
import { configDir } from "./lib/config-dir";
import {
  type GlossaryContext,
  hostsOf,
  loadGlossary,
  resolve as resolveGlossary,
} from "./lib/glossary";
import { missingSlots, slotsOf } from "./lib/lint";
import {
  checkInterceptor,
  checkStack,
  checkTooling,
  runChecks,
  runReset,
} from "./lib/preflight";
import type { TakeRecording } from "./lib/record";
import { DRY_RUN_WAIT_CAP_S, dryRunTake, recordTake } from "./lib/record";
import { describeExpiry, loadSession } from "./lib/session";
import {
  DEFAULTS,
  allGotos,
  allSegments,
  loadStoryboard,
} from "./lib/storyboard";
import { type Timing, renderNarration } from "./lib/tts";
import { describe, resolveVoice } from "./lib/voice";
import { PRODUCT } from "./product";

const HERE = import.meta.dir;
const REPO = PRODUCT.root;
const CONFIG = configDir();

/** Absolute paths are now routine (a demo can live and render outside the
 *  checkout), so print them the way a human reads them. */
function rel(path: string): string {
  if (REPO && path.startsWith(`${REPO}/`)) return path.slice(REPO.length + 1);
  const home = process.env.HOME;
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Where a storyboard was found. Decides where output goes by default: a
 *  storyboard that is not part of this product should not litter the checkout
 *  with its build artifacts. */
type Origin = "repo" | "config" | "path";

function locateStoryboard(arg: string): { path: string; origin: Origin } {
  const configured = join(CONFIG, "storyboards", `${arg}.json`);

  if (arg.endsWith(".json")) {
    const path = resolvePath(process.cwd(), arg);
    if (!existsSync(path)) throw new Error(`No storyboard at ${path}`);
    return {
      path,
      origin: path.startsWith(`${CONFIG}/`) ? "config" : "path",
    };
  }

  const inDocs = PRODUCT.storyboardDir
    ? join(PRODUCT.storyboardDir, `${arg}.json`)
    : null;
  if (inDocs && existsSync(inDocs)) return { path: inDocs, origin: "repo" };
  if (existsSync(configured)) return { path: configured, origin: "config" };

  const looked = [
    inDocs
      ? `    ${rel(inDocs)}      — demos of this product, committed`
      : null,
    `    ${rel(configured)}  — demos of anything else, machine-local`,
  ].filter(Boolean);

  throw new Error(
    `No storyboard "${arg}". Looked in:
${looked.join("\n")}
  See ${PRODUCT.docs}`,
  );
}

function die(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const engineFlag = flag("engine");
if (
  engineFlag !== undefined &&
  engineFlag !== "playwright" &&
  engineFlag !== "interceptor"
) {
  console.error("\n✗ --engine must be playwright or interceptor\n");
  process.exit(1);
}

const target = process.argv[2];
if (!target || target.startsWith("--")) {
  die(
    `usage: ${PRODUCT.cmd.record} <storyboard> [--voice n] [--take n] [--reset] [--dry-run] [--renarrate] [--narrate-only] [--out dir] [--engine playwright|interceptor]`,
  );
}

let located: { path: string; origin: Origin };
try {
  located = locateStoryboard(target);
} catch (e) {
  die((e as Error).message);
}
const sbPath = located.path;
const sb = await loadStoryboard(sbPath).catch((e: Error) => die(e.message));

// Output follows the storyboard unless told otherwise: a config-dir storyboard
// renders beside itself, so a demo of someone else's website never drops build
// artifacts into this checkout.
// An install that belongs to no checkout renders into the config dir whatever
// the storyboard's origin: `join(HERE, "out")` would put build artifacts inside
// the tool's own installation, which a sync would then have to reason about.
const outRoot = flag("out")
  ? resolvePath(process.cwd(), flag("out") as string)
  : located.origin === "config" || PRODUCT.root === null
    ? join(CONFIG, "out")
    : join(HERE, "out");
const outDir = join(outRoot, sb.name);
await mkdir(outDir, { recursive: true });

console.log(`\n${sb.title}`);
console.log(`  storyboard  ${rel(sbPath)}`);
console.log(`  output      ${rel(outDir)}`);
if (PRODUCT.cmd.publish && REPO && !outDir.startsWith(`${REPO}/`)) {
  // `gws --upload` refuses a path outside its working directory, and
  // publish.ts runs it with cwd at the repo root. Say so now rather than at
  // the end of a successful render.
  console.log(
    `  note: this output is outside the checkout, so \`${PRODUCT.cmd.publish}\`
        cannot upload it in place — copy the mp4 under the repo first.`,
  );
}

// ── reset ───────────────────────────────────────────────────────────────────
if (has("reset")) {
  console.log("\nreset");
  const n = await runReset(sb).catch((e: Error) => die(e.message));
  if (n === 0) console.log("  (this storyboard defines no reset statements)");
  // `--reset` alone resets and stops; combined with anything else it is a
  // pre-step to a recording. Keyed on the flags actually passed, not argv's
  // length, so adding a flag like --out cannot silently change this.
  const flagsGiven = process.argv.slice(3).filter((a) => a.startsWith("--"));
  if (flagsGiven.length === 1 && flagsGiven[0] === "--reset") process.exit(0);
}

const timingsPath = join(outDir, "timings.json");
const only = flag("take") ? Number.parseInt(flag("take") as string, 10) : null;

// ── dry run ─────────────────────────────────────────────────────────────────
// Everything a recording would do to the app, and nothing it would do to the
// disk: no clips, no tape, no holds. The point is to find the target that does
// not resolve BEFORE the narrated take that would have died on it. Placed
// before the tooling check on purpose — ffmpeg is a requirement of assembly,
// not of finding out whether `button=/^Next$/` is ambiguous.
if (has("dry-run")) {
  const baseUrl = sb.baseUrl ?? DEFAULTS.baseUrl;
  console.log("\ndry run — no narration, no video, no holds");
  console.log(
    `  waits over ${DRY_RUN_WAIT_CAP_S}s are clipped to ${DRY_RUN_WAIT_CAP_S}s; awaits run in full`,
  );

  // Slot lint first: the one failure class that needs no browser at all.
  if (REPO) {
    const missing = await missingSlots(sb, REPO).catch(() => []);
    if (missing.length > 0) {
      const list = missing.map((s) => `      ${s}`).join("\n");
      console.log(
        `\n  ! ${missing.length} data-slot(s) named by this storyboard appear nowhere under apps/ or packages/:\n${list}\n    A renamed or removed slot fails the walk on its first use. Fix these before running it.`,
      );
    } else {
      const n = slotsOf(sb).length;
      if (n > 0)
        console.log(`  slots    ${n} data-slot(s) all present in source`);
    }
  }

  // Cached clip lengths, if a previous run left them: they let the report say
  // which segments' actions outrun their narration, which is the one timing
  // fact a dry run can offer without synthesising a word.
  const cached: Timing[] = existsSync(timingsPath)
    ? JSON.parse(await readFile(timingsPath, "utf8"))
    : [];
  const clip = new Map(cached.map((t) => [t.id, t.seconds]));
  const pad = sb.pad ?? DEFAULTS.pad;

  await checkStack(baseUrl).catch((e: Error) => die(e.message));

  for (const [i, take] of sb.takes.entries()) {
    const n = i + 1;
    if (only !== null && only !== n) continue;
    console.log(
      `\ntake ${n}/${sb.takes.length}${take.profile ? `  profile: ${take.profile}` : ""}`,
    );
    const session = take.session
      ? await loadSession(take.session).catch((e: Error) => die(e.message))
      : null;
    if (take.preflight?.length) {
      console.log("  preflight");
      await runChecks(take.preflight, baseUrl).catch((e: Error) =>
        die(e.message),
      );
    }
    const report = await dryRunTake(sb, take, outDir, session?.state).catch(
      (e: Error) => die(`dry run failed at ${e.message}`),
    );

    // Actions that take longer than the clip they play under are not a
    // failure — the walk holds until they finish — but the audience hears
    // silence for the difference. Name the segments so the author can decide
    // whether to split the beat or accept the pause.
    const silent = report.segments.filter(
      (s) => clip.has(s.id) && s.actionSeconds > (clip.get(s.id) ?? 0) + pad,
    );
    console.log(
      `  walked ${report.segments.length} segment(s) in ${report.total.toFixed(0)}s`,
    );
    if (silent.length > 0) {
      console.log(
        "  segments whose actions outlast their narration (silence follows the clip):",
      );
      for (const s of silent) {
        const c = clip.get(s.id) ?? 0;
        console.log(
          `    ${s.id}  actions ${s.actionSeconds.toFixed(1)}s  clip ${c.toFixed(1)}s  → ~${(s.actionSeconds - c - pad).toFixed(1)}s of silence`,
        );
      }
    } else if (cached.length > 0) {
      console.log("  every segment's actions finish inside its narration");
    }
  }
  console.log(
    `\n✓ dry run clean — every target resolved.\n  record it:  ${PRODUCT.cmd.record} ${sb.name}${has("reset") ? " --reset" : ""}\n`,
  );
  process.exit(0);
}

// ── tooling ─────────────────────────────────────────────────────────────────
const tooling = await checkTooling();
if (!tooling.ok) {
  die(`Tooling is not ready:\n   - ${tooling.problems.join("\n   - ")}`);
}

// ── narration ───────────────────────────────────────────────────────────────
let timings: Timing[];

// Scope for the machine's pronunciation glossary: hosts come from the
// storyboard's own destinations, contexts are declared by the storyboard.
const glossaryContext: GlossaryContext = {
  hosts: hostsOf(sb.baseUrl ?? DEFAULTS.baseUrl, allGotos(sb)),
  contexts: sb.context ?? [],
};
const glossary = resolveGlossary(
  await loadGlossary().catch((e: Error) => die(e.message)),
  glossaryContext,
);

if (has("assemble-only") && existsSync(timingsPath)) {
  timings = JSON.parse(await readFile(timingsPath, "utf8"));
  console.log(`\nnarration  (reusing ${timings.length} clips)`);
} else {
  const voice = await resolveVoice(flag("voice"), sb.voice).catch((e: Error) =>
    die(e.message),
  );
  console.log(`\nnarration  voice: ${describe(voice)}`);
  if (glossary.length > 0) {
    const scope = [...glossaryContext.contexts, ...glossaryContext.hosts].join(
      ", ",
    );
    console.log(
      `  glossary   ${glossary.length} term(s) in scope${scope ? ` for ${scope}` : ""}`,
    );
  }
  if (voice.source === "fallback") {
    console.log(
      `  note: no voice configured, using the system synthesiser.
        Set one up once with:  ${PRODUCT.cmd.voice} --help`,
    );
  }
  timings = await renderNarration(
    allSegments(sb),
    voice,
    join(outDir, "audio"),
    glossary,
  ).catch((e: Error) => die(e.message));
  await writeFile(timingsPath, `${JSON.stringify(timings, null, 2)}\n`);
  await writeFile(
    join(outDir, "voice.json"),
    `${JSON.stringify({ ...voice, describe: describe(voice) }, null, 2)}\n`,
  );
}

// ── narrate-only ────────────────────────────────────────────────────────────
// Stop here, before the walk. Pronunciation is the one thing that cannot be
// judged from a storyboard — it has to be heard — and `--renarrate` is not a
// complete fix for it: it re-dubs an EXISTING recording, so a corrected clip
// that comes out longer than the one the walk was held for runs past its
// screen. Approving the audio first is therefore cheaper than it looks, and
// costs nothing on the second pass: clips are cached by a hash of text and
// voice, so the later full run reuses every clip that was approved here.
if (has("narrate-only")) {
  const total = timings.reduce((sum, t) => sum + t.seconds, 0);
  console.log("\nnarration only — no walk, no video");
  for (const t of timings) {
    const said = t.spoken ? `  [${t.spoken}]` : "";
    console.log(`  ${t.id}  ${t.seconds.toFixed(1)}s  ${t.file}${said}`);
  }
  console.log(`\n  ${timings.length} clip(s), ${total.toFixed(1)}s total`);
  console.log("\nhear it in order:");
  console.log(`  ${timings.map((t) => `afplay ${t.file}`).join(" && ")}`);
  console.log(
    `\nfix a word:   ${PRODUCT.cmd.glossary} --add <term> --say "<how it sounds>"`,
  );
  console.log(
    `re-render:    ${PRODUCT.cmd.record} <storyboard> --narrate-only`,
  );
  console.log(`then record:  ${PRODUCT.cmd.record} <storyboard>`);
  process.exit(0);
}

// ── takes ───────────────────────────────────────────────────────────────────
const marksPath = (i: number) => join(outDir, `marks-${i + 1}.json`);

if (!has("assemble-only") && !has("renarrate")) {
  const baseUrl = sb.baseUrl ?? DEFAULTS.baseUrl;

  for (const [i, take] of sb.takes.entries()) {
    const n = i + 1;
    if (only !== null && only !== n) continue;

    console.log(
      `\ntake ${n}/${sb.takes.length}${take.profile ? `  profile: ${take.profile}` : ""}`,
    );
    if (take.note) console.log(`  ${take.note}`);
    // Only a take that names an auth profile is talking about the local dev
    // stack. A demo of any other target has no stack to restart, and telling
    // its author to restart one is noise that reads like a prerequisite.
    if (take.profile && PRODUCT.stackHint) {
      console.log(
        `  expects the stack running as:\n    ${PRODUCT.stackHint(take.profile)}`,
      );
    }

    // `--engine` wins over the take, which wins over the storyboard. Resolved
    // here rather than inside the recorder so the precedence is readable.
    const engineName =
      engineFlag ?? take.engine ?? sb.engine ?? DEFAULTS.engine;
    if (engineName === "interceptor") {
      await checkInterceptor().catch((e: Error) => die(e.message));
    }

    // Before the stack check, because a missing or lapsed session is a fact
    // about this machine and says nothing about whether the site is up.
    const session = take.session
      ? await loadSession(take.session).catch((e: Error) => die(e.message))
      : null;
    if (session) {
      console.log(
        `  session  ${take.session} — ${session.summary.domains.join(", ")} (${describeExpiry(session.summary)})`,
      );
    }

    await checkStack(baseUrl).catch((e: Error) => die(e.message));
    if (take.preflight?.length) {
      console.log("  preflight");
      await runChecks(take.preflight, baseUrl).catch((e: Error) =>
        die(e.message),
      );
    }

    const recording = await recordTake(
      sb,
      take,
      timings,
      join(outDir, `video-${n}`),
      session?.state,
      engineName,
    ).catch((e: Error) => die(e.message));
    await writeFile(marksPath(i), `${JSON.stringify(recording, null, 2)}\n`);
    console.log(`  recorded ${recording.total.toFixed(1)}s`);

    // Profiles are restart-only, so stop here and let the operator switch.
    const next = sb.takes[n];
    if (only === null && next?.profile && next.profile !== take.profile) {
      console.log(
        `\n  Take ${n} done. Restart the stack as profile "${next.profile}", then:\n    ${PRODUCT.cmd.record} ${sb.name} --take ${n + 1}\n  When every take is recorded:\n    ${PRODUCT.cmd.record} ${sb.name} --assemble-only`,
      );
      process.exit(0);
    }
  }
}

// ── assemble ────────────────────────────────────────────────────────────────
const recordings: TakeRecording[] = [];
for (const [i] of sb.takes.entries()) {
  if (!existsSync(marksPath(i))) {
    die(
      `take ${i + 1} has not been recorded yet (${marksPath(i)} is missing).\n` +
        `  Record it:  ${PRODUCT.cmd.record} ${sb.name} --take ${i + 1}`,
    );
  }
  recordings.push(JSON.parse(await readFile(marksPath(i), "utf8")));
}

// ── does the new narration still fit the recorded footage? ──────────────────
//
// Only meaningful for a re-dub. On a normal run the walk READ these durations
// and held each screen at least that long, so they fit by construction. On a
// `--renarrate` the video is fixed and the audio has just changed underneath
// it — and `assemble` places each clip at its recorded mark with `adelay`
// without ever looking at the clip's length, so a clip that grew simply plays
// over the next segment's visuals, or past the end of the video, with nothing
// said about it. This is the one way a glossary fix can quietly damage a demo.
if (has("renarrate")) {
  const seconds = new Map(timings.map((t) => [t.id, t.seconds]));
  const overflows: string[] = [];
  for (const [ti, take] of recordings.entries()) {
    for (const [mi, mark] of take.marks.entries()) {
      const clip = seconds.get(mark.id);
      if (clip === undefined || clip === 0) continue;
      // The screen is held until the next mark, or to the end of the walk.
      const next = take.marks[mi + 1];
      const window = (next ? next.t : take.total) - mark.t;
      if (clip > window + 0.05) {
        overflows.push(
          `    take ${ti + 1}  ${mark.id}  clip ${clip.toFixed(1)}s > ${window.toFixed(1)}s of footage  (over by ${(clip - window).toFixed(1)}s)`,
        );
      }
    }
  }
  if (overflows.length > 0) {
    console.log(
      `\n  ! ${overflows.length} clip(s) no longer fit the recording:
${overflows.join("\n")}
    The mp4 will still assemble, and the narration will run over the
    next segment's visuals. Re-record to fix it properly:
      ${PRODUCT.cmd.record} ${sb.name}`,
    );
  } else {
    console.log("\n  every re-narrated clip still fits its recorded footage");
  }
}

console.log("\nassemble");
const output = join(outDir, `${sb.name}.mp4`);
const result = await assemble(recordings, timings, output).catch((e: Error) =>
  die(e.message),
);

await writeFile(
  join(outDir, "manifest.json"),
  `${JSON.stringify(
    {
      name: sb.name,
      title: sb.title,
      storyboard: rel(sbPath),
      generatedAt: new Date().toISOString(),
      voice: JSON.parse(
        await readFile(join(outDir, "voice.json"), "utf8").catch(() => "null"),
      ),
      glossary: timings
        .filter((t) => t.substitutions?.length)
        .map((t) => ({ id: t.id, spoken: t.spoken, terms: t.substitutions })),
      takes: recordings.map((r) => ({
        profile: r.profile,
        session: r.session,
        engine: r.engine,
        total: r.total,
        segments: r.marks.length,
      })),
      output: rel(output),
      duration: result.duration,
      clipsPlaced: result.clipsPlaced,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `\n✓ ${rel(output)}` +
    `  ${result.duration.toFixed(0)}s, ${result.clipsPlaced} narration clips\n`,
);
