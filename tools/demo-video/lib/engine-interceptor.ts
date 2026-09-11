/**
 * The Interceptor engine: your own signed-in Chrome, recorded as a window.
 *
 * ## What this buys, and what it costs
 *
 * It records the real browser profile, so there is no session to capture and
 * nothing to expire — every site you are logged into is already logged in — and
 * it presents no CDP fingerprint, so sites that challenge automation do not.
 *
 * The costs are real and none of them are bugs:
 *
 * - **Not headless.** A window is being recorded. ScreenCaptureKit composites an
 *   occluded window's own surface, so you can work in front of it, but the
 *   window must exist and must not be minimised.
 * - **macOS only**, because ScreenCaptureKit is. Cloud sessions cannot use this.
 * - **Your real accounts.** The walk clicks for real, in your profile. A
 *   storyboard that presses a destructive button presses it.
 * - **Approximated targeting.** Roles and accessible names are computed in the
 *   page (see engine-interceptor-page.ts) rather than by Playwright. Where the two
 *   disagree, Playwright is right.
 * - **Strict-CSP sites need `allowCspStrip`.** A page whose CSP forbids
 *   `unsafe-eval` (Linear, and anything else with Trusted Types) blocks this
 *   engine's resolver outright, in both the main and isolated worlds. The
 *   storyboard can opt in per take, and it is a real trade: for the life of
 *   that one tab on that one host, the site runs without its own XSS defenses
 *   while a session you are signed into is open. Interceptor scopes the rule
 *   to host+tab and drops it when the tab closes, so the exposure is bounded —
 *   but it is not nothing, it is off by default, and the opt-in lives in the
 *   committed storyboard so the decision is legible later.
 * - **`eval` is required**, which is fine everywhere this runs. Claude Code's
 *   worktree isolation refuses a Bash command containing the word `eval` (it
 *   cannot prove no git command escapes the tree, so `interceptor eval` is a
 *   false positive on the word) — but `interceptor` is spawned here with an
 *   argv array, never through a shell, so nothing is analysed and a worktree
 *   session is unaffected. Do not "fix" this by shelling out.
 *
 * ## Permissions
 *
 * Screen Recording, granted to interceptor-bridge. **Not** Accessibility: every
 * action goes through the browser extension, and nothing here moves the real
 * mouse or synthesises a key event at the OS level. That is why the pointer is
 * drawn and positioned rather than following a real cursor.
 */
import { join } from "node:path";
import type { Engine, EngineStartOptions, EngineStarted } from "./engine";
import {
  CURSOR_SCRIPT,
  HIDE_OVERLAY_SCRIPT,
  HIT_ATTR,
  PAGE_SCRIPT,
  glideScript,
  scrollScript,
} from "./engine-interceptor-page";
import type { Action } from "./storyboard";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-agent tab isolation, so a demo never drives a tab you are reading. */
const GROUP = "demo-video";

interface Hit {
  ok: boolean;
  count: number;
  x?: number;
  y?: number;
  inView?: boolean;
  samples?: string[];
}

/**
 * The CLI prints a `[id] → verb` trace line, then its payload. Everything here
 * strips that line first.
 */
function stripTrace(stdout: string): string {
  return stdout.replace(/^\[[0-9a-f]+\]\s+→\s+\S+\n?/m, "").trim();
}

/**
 * `interceptor eval` does NOT accept `--json` — it concatenates unrecognised
 * arguments onto the code, so `--json` arrives as JavaScript and the page
 * throws `Unexpected identifier 'json'` (or, for an expression,
 * `Invalid left-hand side expression in postfix operation`). Position does not
 * help; the flag simply is not parsed by this verb.
 *
 * It also needs `--main`. The default isolated world runs under the
 * EXTENSION's content security policy, which forbids `unsafe-eval`, so
 * evaluating a string there fails on every page — including ones with no CSP
 * of their own, which is what makes the error misleading.
 *
 * Promise-returning code is awaited before the value comes back, which is what
 * makes the rAF animations in engine-interceptor-page.ts usable from out here.
 *
 * All three verified 2026-09-10.
 */
/**
 * Set by the engine when the storyboard opts in. Module-level because every
 * eval in a take shares one decision — a walk that stripped CSP for some of its
 * steps and not others would be the worst of both.
 */
let allowCspStrip = false;

export function setAllowCspStrip(on: boolean): void {
  allowCspStrip = on;
}

/**
 * The one tab this take drives, pinned by id.
 *
 * `--group` is isolation, not addressing: it scopes which tabs the agent may
 * touch, but a verb can still land on a different tab within the group (or,
 * for `tabs`, ignore the filter altogether). That is not theoretical — a take
 * once navigated one tab while the window recorded another, producing a
 * flawless video of the wrong page. Every verb after `open` carries `--tab`.
 */
let activeTab: number | undefined;

function scope(): string[] {
  return activeTab === undefined
    ? ["--group", GROUP]
    : ["--tab", String(activeTab)];
}

async function evalRaw(js: string, what: string): Promise<string> {
  const proc = Bun.spawn(
    [
      "interceptor",
      "eval",
      js,
      "--main",
      ...(allowCspStrip ? ["--allow-csp-strip"] : []),
      ...scope(),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const body = stripTrace(stdout);
  if (proc.exitCode !== 0 || /^error:/i.test(body) || /^error:/i.test(stderr)) {
    throw new Error(`${what}: ${(body || stderr).trim().slice(0, 400)}`);
  }
  return body;
}

async function run(
  args: string[],
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const proc = Bun.spawn(["interceptor", ...args, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;

  // The CLI prefixes a `[id] → verb` trace line before the JSON body.
  const brace = stdout.indexOf("{");
  if (brace < 0) {
    // No JSON body: an error the CLI printed as prose. Strip the trace line so
    // the message reads as the failure rather than as a transcript of one.
    const text = stripTrace(stdout).replace(/^error:\s*/i, "");
    return {
      ok: false,
      data: null,
      error: text || stderr.trim() || `interceptor ${args[0]} produced nothing`,
    };
  }
  let parsed: { success?: boolean; data?: unknown; error?: string };
  try {
    parsed = JSON.parse(stdout.slice(brace));
  } catch (e) {
    return {
      ok: false,
      data: null,
      error: `unparseable reply: ${stdout.slice(brace, brace + 200)}`,
    };
  }
  // Two shapes in the wild: {success, data} from the browser surface and a
  // bare object from some macos verbs. Treat an absent `success` as success
  // only when there is no `error` alongside it.
  const ok = parsed.success ?? parsed.error === undefined;
  return { ok, data: parsed.data ?? parsed, error: parsed.error };
}

async function must(args: string[], what: string): Promise<unknown> {
  const res = await run(args);
  if (!res.ok) throw new Error(`${what}: ${res.error ?? "failed"}`);
  return res.data;
}

export class InterceptorEngine implements Engine {
  readonly name = "interceptor" as const;
  private videoPath: string | null = null;
  private recording = false;
  private drawCursor = false;
  private hideDevOverlay = true;
  private viewport = { width: 1440, height: 900 };
  private tabId: number | undefined;
  private pointer = { x: 80, y: 80 };

  async start(opts: EngineStartOptions): Promise<EngineStarted> {
    if (process.platform !== "darwin") {
      throw new Error(
        `the interceptor engine needs ScreenCaptureKit and so only runs on macOS.
  Use the default engine (playwright) here.`,
      );
    }
    setAllowCspStrip(opts.allowCspStrip === true);
    this.drawCursor = opts.cursor;
    this.hideDevOverlay = opts.hideDevOverlay;
    this.viewport = opts.viewport;
    if (opts.storageState) {
      // Silently ignoring it would be worse: someone would keep a session
      // fresh for a run that never reads it.
      throw new Error(
        "this take names a `session`, but the interceptor engine records your\n" +
          "  real browser profile — it is already signed in, and a saved session\n" +
          "  would be ignored. Drop `session` from the take, or use the\n" +
          "  playwright engine.",
      );
    }

    // Open the walk's first destination in an isolated tab BEFORE recording
    // starts, so frame zero is the product rather than whatever was on screen.
    const opened = (await must(
      // Group-scoped only here: there is no tab to pin to yet, and the group
      // is what keeps the new tab out of whatever you are reading.
      ["open", opts.firstUrl, "--group", GROUP],
      "open the first page",
    )) as { tabId?: number };

    // Foreground it, and this is not cosmetic. A group tab is created in the
    // BACKGROUND, and a background tab is two kinds of broken here: Chrome
    // freezes requestAnimationFrame in it, so the pointer glide and the eased
    // scroll never resolve and every motion times out at 15s; and the window
    // capture records whatever tab is actually on screen, which would be a
    // perfectly valid video of the wrong thing. Recording a window means owning
    // that window for the length of the take.
    if (typeof opened.tabId === "number") {
      this.tabId = opened.tabId;
      activeTab = opened.tabId;
      await must(
        ["tab", "switch", String(opened.tabId)],
        "foreground the demo tab",
      );
      // The switch is not instant, and a frame captured mid-switch is a frame
      // of the previous tab.
      await sleep(600);
    }

    await this.inject();

    // WHICH window. Chrome commonly has several, and the bridge otherwise picks
    // the largest one for the app — which recorded a perfectly good video of an
    // unrelated pull request while the walk drove Linear in a different window.
    // The demo tab is active in its own window, so the Chrome window whose
    // title contains the tab's title is that window.
    const { marker, restore } = await this.markWindow();
    const browserApp = await this.resolveBrowserApp();
    this.videoPath = join(opts.videoDir, "window.mp4");

    const started = (await must(
      [
        "macos",
        "capture",
        "record",
        "start",
        "--out",
        this.videoPath,
        "--app",
        browserApp,
        "--title-contains",
        marker,
        "--fps",
        "30",
        // The drawn pointer composites into the page. Recording the real macOS
        // cursor on top of it would put two pointers in the video.
        "--pixel-scale",
        "1",
      ],
      "start recording",
    )) as { startedAtMs?: number; target?: string; startLatencyMs?: number };

    if (typeof started.startedAtMs !== "number") {
      throw new Error(
        `the bridge did not report startedAtMs — this build of interceptor-bridge
  predates \`capture record\`. Rebuild it: ./scripts/build-bridge.sh`,
      );
    }
    this.recording = true;
    await restore();

    return {
      recStartMs: started.startedAtMs,
      describe: `${browserApp}${started.target ? ` — ${started.target}` : ""} via interceptor${
        started.startLatencyMs !== undefined
          ? ` (frame zero after ${started.startLatencyMs}ms)`
          : ""
      }`,
    };
  }

  /**
   * Stamp a unique marker on the demo tab's title so the right Chrome WINDOW
   * can be picked, and hand back a restore function.
   *
   * Matching on the page's own title is not enough: two windows can each have a
   * tab open on the same page, and the bridge then falls back to whichever is
   * larger. That produced a flawless 59-second recording of a static backlog
   * while the walk drove the identical page in another window — every assertion
   * passing, every frame wrong. A marker cannot be ambiguous.
   *
   * The window filter binds at `record start`, so the title is restored
   * immediately afterwards and never appears on the tape.
   */
  private async markWindow(): Promise<{
    marker: string;
    restore: () => Promise<void>;
  }> {
    const marker = `demo-rec-${Math.random().toString(36).slice(2, 10)}`;
    const original = await evalRaw(
      `(() => { const t = document.title; document.title = ${JSON.stringify(marker)}; return t; })()`,
      "mark the demo window",
    );
    // Chrome repaints the window title asynchronously.
    await sleep(400);
    return {
      marker,
      restore: async () => {
        await evalRaw(
          `(() => { document.title = ${JSON.stringify(original)}; return "ok"; })()`,
          "restore the tab title",
        ).catch(() => "");
      },
    };
  }

  /**
   * Which browser Interceptor is actually driving. Asking the daemon beats
   * guessing: the install supports Chrome, Brave and Safari, and recording the
   * wrong app's window yields a perfectly valid video of the wrong thing.
   */
  private async resolveBrowserApp(): Promise<string> {
    const status = (await run(["status"])).data as {
      browser?: string;
      browserName?: string;
      extension?: { browser?: string };
    } | null;
    const raw = (
      status?.browser ??
      status?.browserName ??
      status?.extension?.browser ??
      ""
    ).toLowerCase();
    if (raw.includes("brave")) return "Brave Browser";
    if (raw.includes("safari")) return "Safari";
    if (raw.includes("chrome")) return "Google Chrome";
    // Fall back to whichever supported browser is running.
    for (const [needle, app] of [
      ["Brave Browser", "Brave Browser"],
      ["Google Chrome", "Google Chrome"],
      ["Safari", "Safari"],
    ] as const) {
      const probe = Bun.spawnSync(["pgrep", "-f", needle]);
      if (probe.exitCode === 0) return app;
    }
    throw new Error(
      "cannot tell which browser interceptor is driving, and none of Brave,\n" +
        "  Chrome or Safari appear to be running. Open one and retry.",
    );
  }

  /** Re-inject after every navigation — there is no addInitScript here. */
  /**
   * Install the page script, and make sure it survived.
   *
   * On a strict-CSP site the FIRST eval is what triggers the header strip, and
   * the strip is followed by a tab reload — so the script installs into a
   * document that is then thrown away, and everything after it resolves against
   * a half-rendered shell. The symptom is every target matching zero elements
   * on a page that visibly contains them. So: install, then confirm the global
   * is actually present in the document now on screen, reinstalling if the
   * reload took it.
   */
  private async inject(): Promise<void> {
    if (this.hideDevOverlay) {
      await evalRaw(HIDE_OVERLAY_SCRIPT, "hide dev overlays").catch(() => "");
    }
    await evalRaw(PAGE_SCRIPT, "install the page script");

    const deadline = Date.now() + 30_000;
    for (;;) {
      const ready = await evalRaw(
        "JSON.stringify({ engine: !!window.__demoEngine, state: document.readyState })",
        "confirm the page script",
      ).catch(() => "");
      let ok = false;
      try {
        const parsed = JSON.parse(ready) as {
          engine?: boolean;
          state?: string;
        };
        ok = parsed.engine === true && parsed.state === "complete";
      } catch {
        ok = false;
      }
      if (ok) break;
      if (Date.now() > deadline) {
        throw new Error(
          "the page script did not survive — the tab keeps reloading, or the page never finished loading",
        );
      }
      await sleep(400);
      await evalRaw(PAGE_SCRIPT, "reinstall the page script").catch(() => "");
    }
    if (this.drawCursor) {
      await evalRaw(CURSOR_SCRIPT, "install the pointer");
      await evalRaw(
        `window.__demoPointer.moveTo(${this.pointer.x},${this.pointer.y})`,
        "seat the pointer",
      );
    }
  }

  private async evalJs(js: string, what: string): Promise<string> {
    return evalRaw(js, what);
  }

  /** Resolve a storyboard target and tag it, returning its geometry. */
  private async hit(spec: string): Promise<Hit> {
    const text = await this.evalJs(
      `JSON.stringify(window.__demoEngine.hit(${JSON.stringify(spec)}))`,
      `resolve target "${spec}"`,
    );
    let hit: Hit;
    try {
      hit = JSON.parse(text) as Hit;
    } catch {
      throw new Error(
        `resolving "${spec}" did not return a result: ${text.slice(0, 200)}`,
      );
    }
    if (!hit.ok) {
      if (hit.count === 0) throw new Error(`no element matched "${spec}"`);
      throw new Error(
        `"${spec}" matched ${hit.count} elements — scope it with \`>>\`:\n${(
          hit.samples ?? []
        )
          .map((s) => `    ${s}`)
          .join("\n")}`,
      );
    }
    return hit;
  }

  /**
   * Turn the tagged hit into an Interceptor element ref.
   *
   * `click` takes `--selector <css>`, but `hover` and `type` take only an index
   * or a ref — passing them a CSS selector positionally is read as a ref and
   * fails with "stale element [undefined]". So everything goes through a ref:
   * the resolver marks the winner with an attribute, and `query` hands back the
   * ref for it.
   */
  private async refForHit(): Promise<string> {
    const data = (await must(
      ["query", `[${HIT_ATTR}]`, ...scope()],
      "resolve the tagged element to a ref",
    )) as { elements?: { ref?: string }[] };
    const ref = data.elements?.[0]?.ref;
    if (!ref) {
      throw new Error(
        "the resolver tagged an element but query could not find it — the page changed underneath the walk",
      );
    }
    return ref;
  }

  /** Wait for a target to resolve to exactly one visible element. */
  private async awaitHit(spec: string, timeoutMs = 30_000): Promise<Hit> {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    for (;;) {
      try {
        return await this.hit(spec);
      } catch (e) {
        last = (e as Error).message;
        if (Date.now() > deadline) {
          throw new Error(`timed out after ${timeoutMs}ms — ${last}`);
        }
        await sleep(250);
      }
    }
  }

  private async glide(hit: Hit): Promise<void> {
    if (!this.drawCursor || hit.x === undefined || hit.y === undefined) return;
    const dist = Math.hypot(hit.x - this.pointer.x, hit.y - this.pointer.y);
    if (dist < 1) return;
    const duration = Math.min(
      1400,
      Math.max(180, (dist / this.viewport.width) * 900),
    );
    await this.evalJs(glideScript(hit.x, hit.y, duration), "glide the pointer");
    await sleep(duration + 40);
    this.pointer = { x: hit.x, y: hit.y };
  }

  /** Bring a target on screen the same way the Playwright engine does —
   *  eased, and only when it is actually out of view. */
  private async scrollIntoViewIfNeeded(hit: Hit): Promise<void> {
    if (hit.inView) return;
    await this.evalJs(scrollScript(null, 600, true), "scroll into view");
    await sleep(660);
  }

  async perform(action: Action, baseUrl: string): Promise<void> {
    if ("goto" in action) {
      await must(
        ["navigate", new URL(action.goto, baseUrl).toString(), ...scope()],
        `navigate to ${action.goto}`,
      );
      await run(["wait-stable", ...scope()]);
      await this.inject();
      return;
    }
    if ("click" in action) {
      const hit = await this.awaitHit(action.click);
      await this.scrollIntoViewIfNeeded(await this.hit(action.click));
      await this.glide(await this.hit(action.click));
      if (this.drawCursor && hit.x !== undefined) {
        await this.evalJs(
          `window.__demoPointer.flash(${this.pointer.x},${this.pointer.y})`,
          "click ripple",
        );
      }
      await must(
        ["click", await this.refForHit(), ...scope()],
        `click ${action.click}`,
      );
      return;
    }
    if ("hover" in action) {
      const hit = await this.awaitHit(action.hover);
      await this.scrollIntoViewIfNeeded(hit);
      await this.glide(await this.hit(action.hover));
      await must(
        ["hover", await this.refForHit(), ...scope()],
        `hover ${action.hover}`,
      );
      await sleep(260);
      return;
    }
    if ("type" in action) {
      const hit = await this.awaitHit(action.type);
      await this.scrollIntoViewIfNeeded(hit);
      await this.glide(await this.hit(action.type));
      const ref = await this.refForHit();
      await must(["click", ref, ...scope()], `focus ${action.type}`);
      await must(
        ["type", ref, action.text, ...scope()],
        `type into ${action.type}`,
      );
      return;
    }
    if ("press" in action) {
      await must(["keys", action.press, ...scope()], `press ${action.press}`);
      return;
    }
    if ("scroll" in action) {
      const hit = await this.awaitHit(action.scroll);
      await this.glide(await this.hit(action.scroll));
      const ms =
        action.ms ?? Math.min(1400, Math.max(260, Math.abs(action.by)));
      await this.evalJs(scrollScript(action.by, ms, false), "scroll");
      await sleep(ms + 40);
      return;
    }
    if ("scrollTo" in action) {
      await this.awaitHit(action.scrollTo);
      const ms = action.ms ?? 600;
      await this.evalJs(
        scrollScript(null, ms, action.onlyIfNeeded ?? false),
        "scroll to target",
      );
      await sleep(ms + 40);
      return;
    }
    if ("awaitUrl" in action) {
      const re = new RegExp(action.awaitUrl);
      const deadline = Date.now() + 30_000;
      for (;;) {
        const state = (await run(["state", ...scope()])).data as {
          url?: string;
        } | null;
        if (state?.url && re.test(state.url)) return;
        if (Date.now() > deadline) {
          throw new Error(
            `url never matched /${action.awaitUrl}/ (last: ${state?.url ?? "unknown"})`,
          );
        }
        await sleep(300);
      }
    }
    if ("awaitText" in action) {
      await this.awaitHit(action.awaitText);
      return;
    }
    if ("wait" in action) {
      await sleep(action.wait * 1000);
      return;
    }
    throw new Error(`unhandled action: ${JSON.stringify(action)}`);
  }

  async stop(): Promise<{ videoPath: string }> {
    if (!this.videoPath) throw new Error("engine not started");
    const result = (await must(
      ["macos", "capture", "record", "stop"],
      "stop recording",
    )) as {
      path?: string;
      finalized?: boolean;
      warning?: string;
      bytes?: number;
    };
    this.recording = false;
    if (result.warning) console.log(`  warning: ${result.warning}`);
    if (!result.bytes) {
      throw new Error(
        `the recording is empty (${this.videoPath}). A minimised window is the
  usual cause — ScreenCaptureKit composites an occluded window but not
  a minimised one.`,
      );
    }
    await run(["tab", "close", ...scope()]);
    activeTab = undefined;
    return { videoPath: result.path ?? this.videoPath };
  }

  async abort(): Promise<{ videoPath?: string }> {
    if (this.recording) {
      await run(["macos", "capture", "record", "stop"]);
      this.recording = false;
    }
    await run(["tab", "close", ...scope()]);
    activeTab = undefined;
    return { videoPath: this.videoPath ?? undefined };
  }
}
