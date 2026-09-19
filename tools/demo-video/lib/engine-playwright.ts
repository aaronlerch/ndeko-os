/**
 * The Playwright engine: headless Chromium, `recordVideo` per context.
 *
 * This is the original implementation of the walk, moved behind `Engine` with
 * its behaviour unchanged. It stays the default because it is the only engine
 * that runs headless (so a recording does not occupy the machine), works in a
 * Linux cloud session, and gets Playwright's strict-mode diagnostics — which
 * name exactly what an ambiguous target matched instead of picking one.
 */
import { chromium } from "playwright";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from "playwright";
import { Cursor } from "./cursor";
import type { Engine, EngineStartOptions, EngineStarted } from "./engine";
import { type ScrollPacing, scrollBy, scrollIntoView } from "./scroll";
import { resolve } from "./selector";
import type { Action } from "./storyboard";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PlaywrightEngine implements Engine {
  readonly name = "playwright" as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cursor: Cursor | null = null;

  async start(opts: EngineStartOptions): Promise<EngineStarted> {
    const browser = await chromium.launch();
    this.browser = browser;
    const context = await browser.newContext({
      viewport: opts.viewport,
      deviceScaleFactor: 1,
      ...(opts.record === false
        ? {}
        : { recordVideo: { dir: opts.videoDir, size: opts.viewport } }),
      // Animations are part of the product. `reduce` would flatten the very
      // celebration screens a demo exists to show.
      reducedMotion: "no-preference",
      // Cookies and localStorage captured by `demo:login`. Applied at context
      // creation, so the very first navigation is already signed in and no
      // sign-in screen reaches the tape.
      ...(opts.storageState
        ? {
            storageState:
              opts.storageState as BrowserContextOptions["storageState"],
          }
        : {}),
    });
    this.context = context;
    const page = await context.newPage();
    this.page = page;
    // The closest observable moment to the first recorded frame: Playwright
    // starts the tape when the context exists.
    const recStartMs = Date.now();

    this.cursor = opts.cursor
      ? await Cursor.install(page, { hideDevOverlay: opts.hideDevOverlay })
      : null;
    if (!this.cursor && opts.hideDevOverlay) {
      await Cursor.hideOverlaysOnly(page);
    }

    // The tape starts the instant the context exists, but the page is still
    // about:blank — which Chromium paints white — so every demo used to open
    // on a blank white flash before the first `goto` landed. Navigate to the
    // walk's first destination BEFORE the clock starts: frame zero is the
    // product.
    await page.goto(opts.firstUrl);
    await this.cursor?.resync();

    return { recStartMs, describe: "headless Chromium" };
  }

  async perform(action: Action, baseUrl: string): Promise<void> {
    if (!this.page) throw new Error("engine not started");
    await perform(this.page, this.cursor, action, baseUrl);
  }

  async stop(): Promise<{ videoPath: string }> {
    const page = this.page;
    if (!page) throw new Error("engine not started");
    const videoPath = await page.video()?.path();
    await this.context?.close();
    await this.browser?.close();
    if (!videoPath) throw new Error("Playwright produced no video file");
    return { videoPath };
  }

  async abort(): Promise<{ videoPath?: string }> {
    const videoPath = await this.page?.video()?.path();
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    return { videoPath: videoPath ?? undefined };
  }

  async snapshot(path: string): Promise<void> {
    if (!this.page) throw new Error("engine not started");
    await this.page.screenshot({ path });
  }
}

/**
 * A storyboard says how long a scroll should take in milliseconds, because that
 * is what an author watching the cut is thinking in. Everything else about
 * pacing is derived from distance.
 */
function pacing(action: { ms?: number }): ScrollPacing {
  return action.ms === undefined ? {} : { minMs: action.ms, maxMs: action.ms };
}

async function perform(
  page: Page,
  cursor: Cursor | null,
  action: Action,
  baseUrl: string,
): Promise<void> {
  if ("goto" in action) {
    await page.goto(new URL(action.goto, baseUrl).toString());
    // The overlay is rebuilt on navigation and sits off-screen until the next
    // mouse event; put the pointer back where the viewer last saw it.
    await cursor?.resync();
    return;
  }
  if ("click" in action) {
    const target = resolve(page, action.click);
    if (cursor) await cursor.click(target);
    else await target.click();
    return;
  }
  if ("hover" in action) {
    const target = resolve(page, action.hover);
    if (cursor) await cursor.hover(target);
    else await target.hover();
    return;
  }
  if ("type" in action) {
    const target = resolve(page, action.type);
    if (cursor) await cursor.click(target, 160);
    else await target.click();
    // Typed key by key so it reads as typing. Instant text reads as a paste.
    await page.keyboard.type(action.text, { delay: action.delay ?? 32 });
    return;
  }
  if ("press" in action) {
    await page.keyboard.press(action.press);
    return;
  }
  if ("scroll" in action) {
    const target = resolve(page, action.scroll);
    // Park the pointer over the region being scrolled first — a page that moves
    // under a cursor sitting somewhere unrelated reads as a glitch. The scroll
    // itself does not depend on where the pointer is (see lib/scroll.ts).
    if (cursor) await cursor.hover(target, 120);
    else await target.hover();
    await scrollBy(target, action.by, pacing(action));
    return;
  }
  if ("scrollTo" in action) {
    const target = resolve(page, action.scrollTo);
    await scrollIntoView(target, {
      onlyIfNeeded: action.onlyIfNeeded ?? false,
      ...pacing(action),
    });
    return;
  }
  if ("awaitUrl" in action) {
    await page.waitForURL(new RegExp(action.awaitUrl), { timeout: 30_000 });
    return;
  }
  if ("awaitText" in action) {
    await resolve(page, action.awaitText).waitFor({
      state: "visible",
      timeout: 30_000,
    });
    return;
  }
  if ("wait" in action) {
    await sleep(action.wait * 1000);
    return;
  }
  throw new Error(`unhandled action: ${JSON.stringify(action)}`);
}
