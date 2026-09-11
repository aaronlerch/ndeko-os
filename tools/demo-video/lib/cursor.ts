/**
 * Synthetic pointer for recorded walks.
 *
 * Two halves. In the page, an injected overlay draws a pointer and a click
 * ripple, and it FOLLOWS real mouse events rather than being positioned
 * directly. In Node, the helpers drive `page.mouse` along an eased path so the
 * movement reads as human instead of teleporting.
 *
 * Because the pointer only ever reflects the real mouse, hover, focus and
 * :active states all fire for real — the recording shows the product responding,
 * not a decoration floating over a dead page.
 *
 * The alternative, compositing a cursor in post from a logged trace, was built
 * and tested (2026-08-29) and rejected: there is no clean t=0 handshake between
 * Playwright's video clock and Node's wall clock, and the cursor visibly lagged
 * the action by seconds. This approach cannot desync, because there is only one
 * clock.
 */
import type { Locator, Page } from "playwright";
import { scrollIntoView } from "./scroll";

/**
 * Injected before every navigation.
 *
 * The `popover` host is load-bearing: the browser's top layer stacks by ENTRY
 * ORDER, not z-index, so an <dialog> opened after us paints straight over the
 * pointer and `z-index: 2147483647` cannot help. Re-entering the top layer
 * whenever the set of open dialogs changes puts the pointer back on top.
 * Verified against a native modal, 2026-08-29.
 */
const OVERLAY = /* js */ `
(() => {
  if (window.__demoCursor) return;
  const state = { x: -100, y: -100, ready: false };
  window.__demoCursor = state;

  function build() {
    if (state.ready) return;
    const host = document.createElement("div");
    host.id = "__demo-cursor-layer";
    host.setAttribute("popover", "manual");
    host.style.cssText = [
      "position:fixed","inset:0","width:100vw","height:100vh","margin:0",
      "padding:0","border:0","background:transparent","overflow:visible",
      "pointer-events:none","z-index:2147483647",
    ].join(";");

    const arrow = document.createElement("div");
    arrow.style.cssText =
      "position:absolute;top:0;left:0;width:22px;height:30px;pointer-events:none;" +
      "will-change:transform;transform:translate3d(-100px,-100px,0);";
    arrow.innerHTML =
      '<svg width="22" height="30" viewBox="0 0 22 30" ' +
      'style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))">' +
      '<path d="M1 1 L1 21.5 L6.1 16.4 L9.3 23.7 L12.6 22.3 L9.4 15.2 L16.4 15 Z" ' +
      'fill="#ffffff" stroke="#101828" stroke-width="1.6" stroke-linejoin="round"/></svg>';

    const ring = document.createElement("div");
    ring.style.cssText =
      "position:absolute;top:0;left:0;width:44px;height:44px;margin:-22px 0 0 -22px;" +
      "border-radius:50%;pointer-events:none;opacity:0;" +
      "border:2px solid rgba(37,99,235,.9);background:rgba(37,99,235,.18);" +
      "transform:translate3d(-100px,-100px,0) scale(.25);";

    host.append(ring, arrow);
    document.documentElement.appendChild(host);
    try { host.showPopover(); } catch {}

    state.ready = true;
    state.place = (x, y) => {
      state.x = x; state.y = y;
      arrow.style.transform = "translate3d(" + x + "px," + y + "px,0)";
      ring.style.transform = "translate3d(" + x + "px," + y + "px,0) scale(.25)";
    };
    state.ripple = () => {
      const at = "translate3d(" + state.x + "px," + state.y + "px,0)";
      ring.style.transition = "none";
      ring.style.opacity = "1";
      ring.style.transform = at + " scale(.25)";
      requestAnimationFrame(() => {
        ring.style.transition =
          "transform 380ms cubic-bezier(.2,.7,.3,1), opacity 380ms ease-out";
        ring.style.opacity = "0";
        ring.style.transform = at + " scale(1)";
      });
    };
    state.place(state.x, state.y);
  }

  addEventListener("mousemove", (e) => {
    if (state.place) state.place(e.clientX, e.clientY);
  }, true);
  addEventListener("mousedown", () => { if (state.ripple) state.ripple(); }, true);

  if (document.documentElement) build();
  else addEventListener("DOMContentLoaded", build, { once: true });

  let sig = "";
  setInterval(() => {
    const host = document.getElementById("__demo-cursor-layer");
    if (!host) {
      // Some frameworks replace <html>'s children during hydration.
      state.ready = false; build();
      if (state.place) state.place(state.x, state.y);
      return;
    }
    const next =
      document.querySelectorAll("dialog[open]").length + ":" +
      document.querySelectorAll(":popover-open").length;
    if (next !== sig) {
      sig = next;
      try { host.hidePopover(); host.showPopover(); } catch {}
    }
  }, 120);
})();
`;

/**
 * The Next.js dev-tools badge sits in the bottom-left of every frame of a
 * `next dev` recording. It renders into a <nextjs-portal> element — confirmed
 * against the installed next@15.5.14, 2026-08-29.
 *
 * Hiding it here rather than setting `devIndicators: false` in next.config.ts
 * keeps the product's own configuration untouched and needs no env-manifest
 * entry. Other frameworks' overlays can be added to the same rule.
 */
const HIDE_DEV_OVERLAY = /* js */ `
(() => {
  const css = "nextjs-portal,#__next-build-watcher,[data-nextjs-toast]" +
    "{display:none !important}";
  const apply = () => {
    if (document.getElementById("__demo-hide-overlay")) return;
    const style = document.createElement("style");
    style.id = "__demo-hide-overlay";
    style.textContent = css;
    (document.head ?? document.documentElement).appendChild(style);
  };
  if (document.documentElement) apply();
  else addEventListener("DOMContentLoaded", apply, { once: true });
})();
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export interface CursorOptions {
  /** Seconds the pointer takes to cross the full viewport width. */
  speed?: number;
  /** Milliseconds between interpolated positions. 16 ~ 60fps. */
  frameMs?: number;
}

export class Cursor {
  private pos = { x: 80, y: 80 };

  private constructor(
    private page: Page,
    private opts: CursorOptions,
  ) {}

  /** Inject the overlay. Call once, before the first navigation. */
  static async install(
    page: Page,
    opts: CursorOptions & { hideDevOverlay?: boolean } = {},
  ): Promise<Cursor> {
    if (opts.hideDevOverlay !== false)
      await page.addInitScript(HIDE_DEV_OVERLAY);
    await page.addInitScript(OVERLAY);
    return new Cursor(page, opts);
  }

  /** Hide dev overlays without drawing a pointer. */
  static async hideOverlaysOnly(page: Page): Promise<void> {
    await page.addInitScript(HIDE_DEV_OVERLAY);
  }

  /**
   * Re-seat the pointer after a navigation.
   *
   * The browser keeps its mouse position across navigations but the injected
   * overlay is rebuilt at (-100,-100) and stays there until the next event, so
   * without this the pointer vanishes for the first beat of every new page.
   */
  async resync(): Promise<void> {
    await this.page.mouse.move(this.pos.x, this.pos.y);
  }

  async glideTo(x: number, y: number): Promise<void> {
    const frameMs = this.opts.frameMs ?? 16;
    const from = { ...this.pos };
    const dist = Math.hypot(x - from.x, y - from.y);
    if (dist < 1) return;
    const vw = this.page.viewportSize()?.width ?? 1440;
    const span = (this.opts.speed ?? 0.9) * 1000;
    const duration = Math.min(1400, Math.max(180, (dist / vw) * span));
    const frames = Math.max(2, Math.round(duration / frameMs));
    for (let i = 1; i <= frames; i++) {
      const t = easeInOut(i / frames);
      await this.page.mouse.move(
        from.x + (x - from.x) * t,
        from.y + (y - from.y) * t,
      );
      await sleep(frameMs);
    }
    this.pos = { x, y };
  }

  async glideToLocator(target: Locator): Promise<void> {
    // Eased, and only when the target is actually out of view. This used to be
    // `scrollIntoViewIfNeeded()`, which teleports — so every click on anything
    // below the fold cut to a new view with no scroll in the storyboard at all.
    await scrollIntoView(target, { onlyIfNeeded: true });
    await target.waitFor({ state: "visible" });
    const box = await target.boundingBox();
    if (!box) {
      throw new Error("target is visible but has no bounding box");
    }
    await this.glideTo(box.x + box.width / 2, box.y + box.height / 2);
  }

  /** Move onto a target and pause, without clicking. */
  async hover(target: Locator, hoverMs = 260): Promise<void> {
    await this.glideToLocator(target);
    await sleep(hoverMs);
  }

  /** Move onto a target, pause on hover, then click it for real. */
  async click(target: Locator, hoverMs = 260): Promise<void> {
    await this.hover(target, hoverMs);
    await this.page.mouse.down();
    await sleep(80);
    await this.page.mouse.up();
  }
}
