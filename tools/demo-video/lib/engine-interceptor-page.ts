/**
 * Page-side script for the Interceptor engine.
 *
 * Injected once per navigation via `interceptor eval`, because Interceptor has
 * no `addInitScript` equivalent — there is no hook that runs before a document
 * loads, so re-injection after every navigation is the mechanism, not an
 * oversight.
 *
 * It provides three things the Playwright engine gets from Playwright:
 *
 * 1. **A target resolver** for the storyboard grammar. Interceptor addresses
 *    elements by `[eN]` refs from a tree read, which cannot express
 *    `css=… >> has=… >> button=…`. So the grammar is resolved in the page and
 *    the winner is tagged with a unique attribute the CLI can then query by.
 *    Role and accessible name are APPROXIMATED — tag/`role` mapping, and
 *    `aria-label` ?? `alt` ?? `title` ?? text. That covers buttons, links,
 *    headings, tabs and inputs; it is not Playwright's full ARIA computation,
 *    and where the two disagree Playwright is right.
 * 2. **A directly-positioned pointer.** The Playwright overlay follows real
 *    mouse events, which needs a real mouse; moving one means CGEvent, which
 *    means an Accessibility grant this engine deliberately does not require.
 *    So here the pointer is placed rather than followed.
 * 3. **Eased scrolling**, same rAF approach as `lib/scroll.ts` — no `wheel`
 *    events, which is the documented limitation there too.
 */

/** Attribute the resolver stamps on a winning element. */
export const HIT_ATTR = "data-demo-hit";

export const PAGE_SCRIPT = /* js */ `
(() => {
  if (window.__demoEngine) return "already";

  const HIT = ${JSON.stringify(HIT_ATTR)};
  const ROLE_TOKENS = {
    button: "button", link: "link", heading: "heading", tab: "tab",
    checkbox: "checkbox", radio: "radio", textbox: "textbox", option: "option",
  };

  function matcher(raw) {
    const m = raw.match(/^\\/(.*)\\/([gimsuy]*)$/);
    if (m) { const re = new RegExp(m[1], m[2]); return (s) => re.test(s || ""); }
    const needle = raw.toLowerCase();
    // Playwright's role-name match is case-insensitive substring; getByText is
    // substring too. One predicate covers both.
    return (s) => (s || "").toLowerCase().includes(needle);
  }

  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return el.hasAttribute("href") ? "link" : null;
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "option") return "option";
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "button" || t === "submit" || t === "reset") return "button";
      if (t === "hidden") return null;
      return "textbox";
    }
    if (tag === "summary") return "button";
    return null;
  }

  function nameOf(el) {
    const labelled = el.getAttribute("aria-labelledby");
    if (labelled) {
      const parts = labelled.split(/\\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => n.textContent || "");
      if (parts.length) return parts.join(" ").trim();
    }
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("alt") ||
      el.getAttribute("title") ||
      (el.tagName.toLowerCase() === "input" &&
        (el.getAttribute("type") || "").toLowerCase() !== "text"
        ? el.getAttribute("value") || ""
        : "") ||
      (el.textContent || "")
    ).replace(/\\s+/g, " ").trim();
  }

  function labelFor(el) {
    const direct = nameOf(el);
    if (direct) return direct;
    if (el.id) {
      const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab) return (lab.textContent || "").replace(/\\s+/g, " ").trim();
    }
    const wrapping = el.closest("label");
    if (wrapping) return (wrapping.textContent || "").replace(/\\s+/g, " ").trim();
    return "";
  }

  const visible = (el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };

  function within(scope, selector) {
    const roots = scope.length ? scope : [document];
    const out = [];
    for (const root of roots) {
      for (const el of root.querySelectorAll(selector)) out.push(el);
    }
    return out;
  }

  function byRole(scope, role, raw) {
    const test = raw ? matcher(raw) : null;
    return within(scope, "*").filter(
      (el) => roleOf(el) === role && (!test || test(nameOf(el))),
    );
  }

  // Mirrors lib/selector.ts. Kinds and chaining semantics are the same; the
  // difference is that role/name are approximated (see the header).
  function segment(scope, kind, raw, isFirst) {
    if (ROLE_TOKENS[kind]) return byRole(scope, ROLE_TOKENS[kind], raw);
    switch (kind) {
      case "role": {
        const [role, ...rest] = raw.split(":");
        return byRole(scope, role, rest.join(":") || null);
      }
      case "text": {
        const test = matcher(raw);
        // Deepest match wins, the way getByText resolves to the element that
        // owns the text rather than every ancestor containing it.
        const all = within(scope, "*").filter((el) => test(el.textContent || ""));
        return all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
      }
      case "label": {
        const test = matcher(raw);
        return within(scope, "input,textarea,select,[role=textbox]").filter((el) =>
          test(labelFor(el)),
        );
      }
      case "placeholder": {
        const test = matcher(raw);
        return within(scope, "[placeholder]").filter((el) =>
          test(el.getAttribute("placeholder")),
        );
      }
      case "title": {
        const test = matcher(raw);
        return within(scope, "[title]").filter((el) => test(el.getAttribute("title")));
      }
      case "testid":
        return within(scope, '[data-testid="' + CSS.escape(raw) + '"]');
      case "css":
        return within(scope, raw);
      case "has": {
        const test = matcher(raw);
        return scope.filter((el) => test(el.textContent || ""));
      }
      case "hasNot": {
        const test = matcher(raw);
        return scope.filter((el) => !test(el.textContent || ""));
      }
      case "nth": {
        const i = parseInt(raw, 10);
        const picked = scope[i];
        return picked ? [picked] : [];
      }
      default:
        throw new Error(
          'unknown target kind "' + kind + '"' + (isFirst ? "" : " (chained)"),
        );
    }
  }

  function resolveAll(spec) {
    const parts = spec.split(">>").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) throw new Error('empty target: "' + spec + '"');
    let scope = [];
    let first = true;
    for (const part of parts) {
      if (part === "first") { scope = scope.slice(0, 1); continue; }
      if (part === "last") { scope = scope.slice(-1); continue; }
      const eq = part.indexOf("=");
      if (eq < 1) {
        throw new Error('target segment "' + part + '" in "' + spec + '" is not kind=value');
      }
      scope = segment(scope, part.slice(0, eq).trim(), part.slice(eq + 1).trim(), first);
      first = false;
    }
    return scope;
  }

  const state = {
    x: 80, y: 80,
    /**
     * Resolve a target and tag the winner so the CLI can act on it by ref.
     *
     * Strictness is deliberate and mirrors Playwright: more than one visible
     * match is an ERROR naming the count, not a silent pick of the first. A
     * target that matched a heading and a sentence is how the first recorded
     * walk died, and a resolver that guesses hides that until you watch the
     * finished video.
     */
    hit(spec) {
      for (const el of document.querySelectorAll("[" + HIT + "]")) {
        el.removeAttribute(HIT);
      }
      const all = resolveAll(spec);
      const shown = all.filter(visible);
      const pick = shown.length ? shown : all;
      if (pick.length === 0) return { ok: false, count: 0 };
      if (pick.length > 1) {
        return {
          ok: false,
          count: pick.length,
          samples: pick.slice(0, 4).map(
            (el) => el.tagName.toLowerCase() + ' "' +
              (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 48) + '"',
          ),
        };
      }
      const el = pick[0];
      el.setAttribute(HIT, "1");
      const r = el.getBoundingClientRect();
      return {
        ok: true, count: 1,
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        visible: visible(el),
        inView: r.top >= 0 && r.bottom <= innerHeight,
      };
    },
  };
  window.__demoEngine = state;
  return "installed";
})()
`;

/**
 * Pointer overlay. Separate from PAGE_SCRIPT so a run with `cursor: false`
 * injects nothing at all rather than a dormant layer.
 *
 * Unlike the Playwright overlay this is POSITIONED, not event-following: with
 * no Accessibility grant there is no real mouse to follow. The consequence is
 * that the drawn pointer and the acting element are two coupled things instead
 * of one, kept in order by being sequential CLI calls rather than by a clock.
 */
export const CURSOR_SCRIPT = /* js */ `
(() => {
  if (window.__demoPointer) return "already";
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
    "background-repeat:no-repeat;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));" +
    "background-image:url('data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">' +
      '<path d="M2 1 L2 22 L7.5 17.2 L11.2 26.5 L14.8 25 L11.2 15.8 L18.5 15.5 Z" ' +
      'fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    ) + "');";
  host.appendChild(arrow);
  const ripple = document.createElement("div");
  ripple.style.cssText =
    "position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;" +
    "border:2px solid rgba(0,0,0,.35);opacity:0;pointer-events:none;transition:none;";
  host.appendChild(ripple);

  function attach() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    // The top layer stacks by ENTRY ORDER, not z-index, so a <dialog> opened
    // after us paints over the pointer and no z-index can help. Re-entering
    // puts it back on top. (Same fix as lib/cursor.ts, same reason.)
    try { host.hidePopover(); } catch {}
    try { host.showPopover(); } catch {}
  }

  const state = {
    moveTo(x, y) {
      attach();
      arrow.style.transform = "translate(" + x + "px," + y + "px)";
    },
    flash(x, y) {
      attach();
      ripple.style.transition = "none";
      ripple.style.left = x + "px";
      ripple.style.top = y + "px";
      ripple.style.opacity = "0.9";
      ripple.style.transform = "scale(0.4)";
      requestAnimationFrame(() => {
        ripple.style.transition = "opacity 320ms ease-out, transform 320ms ease-out";
        ripple.style.opacity = "0";
        ripple.style.transform = "scale(1.6)";
      });
    },
  };
  window.__demoPointer = state;
  state.moveTo(80, 80);
  return "installed";
})()
`;

/** Hide framework dev badges, same targets as the Playwright engine's. */
export const HIDE_OVERLAY_SCRIPT = /* js */ `
(() => {
  const id = "__demo-hide-dev-overlay";
  if (document.getElementById(id)) return "already";
  const style = document.createElement("style");
  style.id = id;
  style.textContent =
    "nextjs-portal,#__next-build-watcher,[data-nextjs-toast]{display:none!important}";
  document.head?.appendChild(style);
  return "installed";
})()
`;

/**
 * Glide the drawn pointer along an eased path, and — separately — scroll.
 *
 * Both run wholly in the page on rAF, one `eval` per motion, because a
 * per-frame CLI round trip at 60fps is ~70ms of process spawn per frame
 * (measured 2026-09-10) and would make the motion the slowest thing in the
 * walk.
 */
export function glideScript(
  toX: number,
  toY: number,
  durationMs: number,
): string {
  return /* js */ `
(() => {
  const p = window.__demoPointer;
  if (!p) return "no-pointer";
  const el = document.getElementById("__demo-cursor-layer")
    ?.firstElementChild;
  const from = (() => {
    const m = /translate\\(([-\\d.]+)px,\\s*([-\\d.]+)px\\)/.exec(
      el?.style.transform || "",
    );
    return m ? { x: +m[1], y: +m[2] } : { x: 80, y: 80 };
  })();
  const to = { x: ${toX}, y: ${toY} };
  const dur = ${durationMs};
  const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
  return new Promise((done) => {
    const t0 = performance.now();
    function step(now) {
      const t = Math.min(1, (now - t0) / dur);
      const k = ease(t);
      p.moveTo(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      if (t < 1) requestAnimationFrame(step);
      else done("ok");
    }
    requestAnimationFrame(step);
  });
})()
`;
}

/** Eased scroll of the container at the tagged hit, or of the page. */
export function scrollScript(
  by: number | null,
  durationMs: number,
  onlyIfNeeded: boolean,
): string {
  return /* js */ `
(() => {
  const hit = document.querySelector("[${HIT_ATTR}]");
  const scrollableAncestor = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll|overlay)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight) {
        return n;
      }
    }
    return document.scrollingElement || document.documentElement;
  };
  const ease = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
  const animate = (node, from, to, dur) =>
    new Promise((done) => {
      if (Math.abs(to - from) < 1) return done("noop");
      const t0 = performance.now();
      function step(now) {
        const t = Math.min(1, (now - t0) / dur);
        node.scrollTop = from + (to - from) * ease(t);
        if (t < 1) requestAnimationFrame(step);
        else done("ok");
      }
      requestAnimationFrame(step);
    });

  ${
    by !== null
      ? `
  if (!hit) return "no-hit";
  const node = /(auto|scroll|overlay)/.test(getComputedStyle(hit).overflowY) &&
    hit.scrollHeight > hit.clientHeight ? hit : scrollableAncestor(hit);
  return animate(node, node.scrollTop, node.scrollTop + ${by}, ${durationMs});`
      : `
  if (!hit) return "no-hit";
  const r = hit.getBoundingClientRect();
  if (${onlyIfNeeded} && r.top >= 0 && r.bottom <= innerHeight) return "noop";
  const node = scrollableAncestor(hit);
  const nodeTop = node === (document.scrollingElement || document.documentElement)
    ? 0
    : node.getBoundingClientRect().top;
  // Park it near the top rather than centred, so the shot lands the same way
  // every take — the whole reason scrollTo does not use onlyIfNeeded by default.
  const target = node.scrollTop + (r.top - nodeTop) - 80;
  return animate(node, node.scrollTop, Math.max(0, target), ${durationMs});`
  }
})()
`;
}
