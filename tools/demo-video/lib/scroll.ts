/**
 * Eased scrolling, so the page travels instead of cutting.
 *
 * Two things used to jump. The `scroll` action fired one `page.mouse.wheel`,
 * which lands as a single discrete delta. And `glideToLocator` called
 * `scrollIntoViewIfNeeded()` before every click, hover and type — so any target
 * below the fold teleported the page with no scroll at all in the storyboard.
 * The second is the one you notice: a demo that never says "scroll" still cuts.
 *
 * The animation runs INSIDE THE PAGE on requestAnimationFrame rather than as
 * stepped `mouse.wheel` calls from Node. Three reasons, in order of weight:
 *
 *   1. It scrolls the right thing. A wheel event scrolls whatever sits under
 *      the pointer, which for an implicit scroll-before-click is wherever the
 *      cursor happens to be. Resolving the scroll chain in the page and driving
 *      it directly cannot address the wrong element.
 *   2. Chromium applies its own smoothing and inertia to wheel input, which
 *      fights an easing curve layered on top of it. Writing `scrollTop` does not.
 *   3. rAF runs at the compositor's own cadence, so every frame Playwright
 *      captures is a frame the browser actually painted.
 *
 * The cost: no `wheel` events are dispatched. A component listening for `wheel`
 * specifically — a virtualised list, a scroll hijacker, a canvas zoom — will not
 * see this. `scroll` events fire normally, which is what sticky headers,
 * scroll-spy and IntersectionObserver use. If a demo ever needs real wheel
 * input, that is a new action rather than a change to this one.
 *
 * Nested scrollers are handled: the whole chain from the element up to the
 * document animates on one clock, so a card inside a scrollable panel inside a
 * scrolling page arrives without three separate lurches.
 */
import type { Locator, Page } from "playwright";

export interface ScrollPacing {
  /** Travel speed. Duration is derived from distance, then clamped. */
  pxPerSec?: number;
  minMs?: number;
  maxMs?: number;
}

/**
 * Roughly a 900px viewport in 0.6s: fast enough not to bore, slow enough that
 * the eye tracks content rather than seeing a blur.
 */
const PACING: Required<ScrollPacing> = {
  pxPerSec: 1500,
  minMs: 260,
  maxMs: 1400,
};

interface AnimateOptions extends Required<ScrollPacing> {
  mode: "by" | "into";
  by: number;
  margin: number;
  onlyIfNeeded: boolean;
}

/**
 * Runs in the page: resolves the scroll chain, computes a destination for each
 * scroller, then animates all of them together.
 *
 * Returns the total distance travelled, so a caller can tell a real scroll from
 * a no-op without a second round trip. Self-contained by necessity — Playwright
 * serialises this to source, so it closes over nothing.
 */
function animate(node: HTMLElement, opts: AnimateOptions): Promise<number> {
  const { mode, by, margin, onlyIfNeeded, pxPerSec, minMs, maxMs } = opts;
  const doc = (document.scrollingElement ??
    document.documentElement) as HTMLElement;

  const scrollable = (n: HTMLElement): boolean => {
    if (n.scrollHeight <= n.clientHeight + 1) return false;
    if (n === doc) return true;
    const oy = getComputedStyle(n).overflowY;
    return oy === "auto" || oy === "scroll" || oy === "overlay";
  };

  // Innermost first. "by" starts at the element itself — the storyboard names
  // the container it wants moved. "into" starts at its parent, because there
  // the element is the thing being revealed, not the thing that scrolls.
  const chain: HTMLElement[] = [];
  let n: HTMLElement | null = mode === "by" ? node : node.parentElement;
  while (
    n &&
    n !== doc &&
    n !== document.body &&
    n !== document.documentElement
  ) {
    if (scrollable(n)) chain.push(n);
    n = n.parentElement;
  }
  if (scrollable(doc)) chain.push(doc);
  if (chain.length === 0) return Promise.resolve(0);

  const viewportOf = (s: HTMLElement) => {
    if (s === doc) return { top: 0, height: doc.clientHeight };
    return { top: s.getBoundingClientRect().top, height: s.clientHeight };
  };

  const clampTo = (s: HTMLElement, v: number) =>
    Math.max(0, Math.min(v, s.scrollHeight - s.clientHeight));

  const plans: { el: HTMLElement; from: number; to: number }[] = [];

  if (mode === "by") {
    const s = chain[0] as HTMLElement;
    plans.push({ el: s, from: s.scrollTop, to: clampTo(s, s.scrollTop + by) });
  } else {
    // Each scroller in turn, working outward: place the element's top a little
    // below the top of that scroller's viewport. `pending` carries how far the
    // inner scrollers will have already moved the element by the time the outer
    // one runs, so each destination is computed against where it will be.
    let pending = 0;
    for (const s of chain) {
      const view = viewportOf(s);
      const rect = node.getBoundingClientRect();
      const gap = Math.min(margin, Math.max(0, view.height * 0.25));
      const elTop = rect.top - pending;
      let delta = elTop - (view.top + gap);

      if (onlyIfNeeded) {
        const topIn = elTop >= view.top + 4;
        const bottomIn = elTop + rect.height <= view.top + view.height - 4;
        if (topIn && bottomIn) {
          plans.push({ el: s, from: s.scrollTop, to: s.scrollTop });
          continue;
        }
        // Visible but hanging off the bottom: nudging it just inside is less
        // disorienting than yanking its top up to the gap.
        if (topIn && !bottomIn) {
          const overhang = elTop + rect.height - (view.top + view.height - gap);
          if (overhang < delta) delta = overhang;
        }
      }

      const to = clampTo(s, s.scrollTop + delta);
      plans.push({ el: s, from: s.scrollTop, to });
      pending += to - s.scrollTop;
    }
  }

  const distance = plans.reduce((a, p) => a + Math.abs(p.to - p.from), 0);
  if (distance < 2) return Promise.resolve(0);

  const duration = Math.max(
    minMs,
    Math.min(maxMs, (distance / pxPerSec) * 1000),
  );

  // An app-level `scroll-behavior: smooth` would layer the browser's own easing
  // on top of ours and fight it. Neutralise it, then restore exactly what was
  // there — including "nothing", which is not the same as the empty string once
  // an inline style has been set.
  const saved = plans.map((p) => {
    const had = p.el.style.scrollBehavior;
    p.el.style.scrollBehavior = "auto";
    return had;
  });

  const ease = (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

  return new Promise<number>((resolve) => {
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = ease(t);
      for (const p of plans) p.el.scrollTop = p.from + (p.to - p.from) * e;
      if (t < 1) {
        requestAnimationFrame(frame);
        return;
      }
      plans.forEach((p, i) => {
        const had = saved[i];
        if (had) p.el.style.scrollBehavior = had;
        else p.el.style.removeProperty("scroll-behavior");
      });
      resolve(distance);
    };
    requestAnimationFrame(frame);
  });
}

function options(
  mode: "by" | "into",
  extra: Partial<AnimateOptions>,
  pacing: ScrollPacing,
): AnimateOptions {
  return {
    mode,
    by: 0,
    margin: 120,
    onlyIfNeeded: false,
    ...PACING,
    ...pacing,
    ...extra,
  };
}

/**
 * Scroll the container at `target` by `by` pixels, eased.
 *
 * If `target` is not itself scrollable its nearest scrollable ancestor is used,
 * which makes `{ scroll: "text=Recent activity", by: 400 }` do the obvious
 * thing rather than silently scrolling nothing.
 */
export async function scrollBy(
  target: Locator,
  by: number,
  pacing: ScrollPacing = {},
): Promise<number> {
  await target.waitFor({ state: "attached" });
  return target.evaluate(animate, options("by", { by }, pacing));
}

/**
 * Bring `target` into view by scrolling every scroller between it and the
 * document, eased. Returns distance travelled; 0 means nothing moved.
 */
export async function scrollIntoView(
  target: Locator,
  opts: { onlyIfNeeded?: boolean; margin?: number } & ScrollPacing = {},
): Promise<number> {
  const { onlyIfNeeded = false, margin = 120, ...pacing } = opts;
  await target.waitFor({ state: "attached" });
  return target.evaluate(
    animate,
    options("into", { onlyIfNeeded, margin }, pacing),
  );
}

/** Scroll the page itself, with no target — `html` stands in for the document. */
export async function scrollPageBy(
  page: Page,
  by: number,
  pacing: ScrollPacing = {},
): Promise<number> {
  return scrollBy(page.locator("html"), by, pacing);
}
