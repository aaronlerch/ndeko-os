/**
 * Static checks on a storyboard that need no browser and no stack.
 *
 * One check today: every `data-slot` a `css=` target names has to appear
 * somewhere in this product's source. A slot is the most stable handle a
 * storyboard has — it is why the authoring guide prefers it — but it is also
 * a string with no compiler behind it. When a component renames its slot the
 * storyboard keeps validating and the walk fails thirty seconds in, on the
 * first click, with a "waiting for locator" timeout that says nothing about
 * WHY. Reading the tree first turns that into a one-line answer before the
 * browser opens.
 *
 * A hit is a substring match on the quoted slot name across `apps/` and
 * `packages/`, so a slot built from a variable is missed and a slot that is
 * present is never reported absent — the check warns, it does not fail, and
 * the walk that follows is the truth.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Storyboard, allSegments } from "./storyboard";

const SLOT = /\[data-slot="([^"]+)"\]/g;

/** Every target string in the storyboard, whatever verb carries it. */
function targetsOf(sb: Storyboard): string[] {
  const out: string[] = [];
  for (const seg of allSegments(sb)) {
    for (const action of seg.do ?? []) {
      for (const key of [
        "click",
        "hover",
        "type",
        "scroll",
        "scrollTo",
        "awaitText",
      ] as const) {
        const v = (action as Record<string, unknown>)[key];
        if (typeof v === "string") out.push(v);
      }
    }
  }
  return out;
}

export function slotsOf(sb: Storyboard): string[] {
  const slots = new Set<string>();
  for (const target of targetsOf(sb)) {
    for (const m of target.matchAll(SLOT)) slots.add(m[1] as string);
  }
  return [...slots].sort();
}

/**
 * Names the slots that appear nowhere under `<root>/apps` or `<root>/packages`.
 * Reads every `.ts`/`.tsx` there once (a few thousand files, well under a
 * second) rather than shelling out to a grep that may not be installed.
 */
export async function missingSlots(
  sb: Storyboard,
  root: string,
): Promise<string[]> {
  const slots = slotsOf(sb);
  if (slots.length === 0) return [];

  const glob = new Bun.Glob("{apps,packages}/**/*.{ts,tsx}");
  const needles = new Map(slots.map((s) => [s, `"${s}"`]));
  const found = new Set<string>();
  for await (const rel of glob.scan({ cwd: root })) {
    if (rel.includes("node_modules/") || rel.includes("/.next/")) continue;
    const text = await readFile(join(root, rel), "utf8").catch(() => "");
    for (const [slot, needle] of needles) {
      if (!found.has(slot) && text.includes(needle)) found.add(slot);
    }
    if (found.size === needles.size) break;
  }
  return slots.filter((s) => !found.has(s));
}
