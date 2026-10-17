/**
 * A translucent label burned into the bottom-right corner of every frame, so a
 * video that travels further than it should still says what it is —
 * "confidential, internal only" on a demo of unreleased work.
 *
 * On by default wherever the install names one (`PRODUCT.watermark`), because
 * the failure it guards against is a forgotten flag: a demo recorded for the
 * team ends up in front of a customer. Turning it off is a deliberate act —
 * `--no-watermark` for one render, `"watermark": false` in a storyboard that
 * is meant to be shared.
 *
 * The label is rendered to a transparent PNG by the same headless Chromium the
 * pipeline already depends on, then composited by ffmpeg's `overlay`. Not
 * `drawtext`: that filter only exists in ffmpeg builds linked against
 * freetype, and the Homebrew build on at least one machine (2026-10-17,
 * ffmpeg 9.0.2) has no `drawtext` at all. A browser has fonts everywhere.
 *
 * Applied at assembly, so `--assemble-only` and `--renarrate` re-render with
 * or without it and no take ever needs repeating to change it.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * The text this render carries, or `null` for none. First answer wins:
 * `--no-watermark`, `--watermark "<text>"`, the storyboard's `watermark`
 * (`false` off, a string replaces the text, `true` or absent defers), then the
 * install's default.
 */
export function resolveWatermark(opts: {
  off: boolean;
  flag: string | undefined;
  storyboard: boolean | string | undefined;
  product: string | null;
}): string | null {
  if (opts.off) return null;
  if (opts.flag !== undefined) return opts.flag.trim() || null;
  if (opts.storyboard === false) return null;
  if (typeof opts.storyboard === "string") {
    return opts.storyboard.trim() || null;
  }
  return opts.product?.trim() || null;
}

/** Pixel height of a video's first stream. */
export async function probeHeight(file: string): Promise<number> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=height",
      "-of",
      "csv=p=0",
      file,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  const height = Number.parseInt(
    (await new Response(proc.stdout).text()).trim(),
    10,
  );
  if (code !== 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`ffprobe could not read a frame height from ${file}`);
  }
  return height;
}

/**
 * Render `text` as a transparent PNG sized for a video `height` pixels tall,
 * cached in `dir` by text and size. Returns the PNG's path.
 *
 * Light text on a dark translucent pill, the whole thing at partial opacity:
 * readable over a white product page and a dark one alike, and plainly an
 * overlay rather than part of the UI.
 */
export async function renderWatermark(
  text: string,
  height: number,
  dir: string,
): Promise<string> {
  // ~2% of frame height: legible at 1080p, unobtrusive at 900.
  const font = Math.max(12, Math.round(height * 0.02));
  const key = createHash("sha256")
    .update(JSON.stringify([text, font]))
    .digest("hex")
    .slice(0, 12);
  const path = join(dir, `watermark-${key}.png`);
  if (existsSync(path)) return path;
  await mkdir(dir, { recursive: true });

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
<span id="wm" style="display:inline-block;padding:${Math.round(font * 0.45)}px ${Math.round(font * 0.8)}px;border-radius:${Math.round(font * 0.5)}px;background:rgba(0,0,0,0.45);color:#fff;opacity:0.7;font:600 ${font}px/1.2 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:0.04em;white-space:nowrap"></span>
</body></html>`);
    // Set as text, never as markup: the label is configuration, not HTML.
    await page.locator("#wm").evaluate((el, t) => {
      el.textContent = t;
    }, text);
    await page
      .locator("#wm")
      .screenshot({ path, omitBackground: true, animations: "disabled" });
  } finally {
    await browser.close();
  }
  return path;
}
