/**
 * How words are said — a machine-local glossary that rewrites narration text on
 * its way to the synthesiser.
 *
 *   ${XDG_CONFIG_HOME:-~/.config}/demo-video/glossary.json
 *
 * It lives in the shared config dir, beside the voice config, so a correction
 * made once applies to every storyboard on this machine — the product repo's
 * demos and the global install's alike. A pronunciation is a property of the
 * machine's voice, not of any one demo.
 *
 * **Respellings, not phonemes.** An entry replaces a term with ordinary letters
 * that happen to sound right ("Todo" → "too doo"). The obvious alternative was
 * phoneme markup — SSML, macOS `[[inpt PHON]]`, eSpeak's IPA — and it is wrong
 * here for one decisive reason: the voice tier is "any binary that accepts
 * `--text`", so markup that one engine honours another passes straight through
 * and SPEAKS, turning a mispronounced word into a recitation of its phonetic
 * spelling. A respelling degrades to "still intelligible" on every engine, and
 * a human reviewing the glossary can read it.
 *
 * **Scope, because a word's pronunciation depends on what is on screen.**
 * "Todo" is *too-DOO* in a Linear demo and *TOE-doe* if it is someone's name.
 * An entry may be scoped to hosts, to named contexts, or left unscoped as the
 * machine-wide default. Resolution is most-specific-wins:
 *
 *   contexts match → 2   hosts match → 1   unscoped → 0
 *
 * An entry carrying a `when` that does NOT match is excluded outright — a
 * Linear-scoped pronunciation must never leak into a demo of something else,
 * which is the entire point of scoping it.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { configDir } from "./config-dir";

export interface GlossaryEntry {
  /** The word as it appears in narration. Matched case-insensitively. */
  term: string;
  /** Ordinary letters that sound right. This is what the synthesiser reads. */
  say: string;
  /** Scope. Omit for the machine-wide default pronunciation. */
  when?: {
    /** Hostnames this applies to, e.g. "linear.app". */
    hosts?: string[];
    /** Named contexts a storyboard opts into with its `context` field. */
    contexts?: string[];
  };
  /** Why — shown when listing, and the reason a later reader keeps it. */
  because?: string;
}

export interface Glossary {
  version: 1;
  entries: GlossaryEntry[];
}

/** What a storyboard contributes to scope resolution. */
export interface GlossaryContext {
  hosts: string[];
  contexts: string[];
}

export const EMPTY_CONTEXT: GlossaryContext = { hosts: [], contexts: [] };

export function glossaryPath(): string {
  return join(configDir(), "glossary.json");
}

export async function loadGlossary(): Promise<Glossary> {
  const path = glossaryPath();
  if (!existsSync(path)) return { version: 1, entries: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    throw new Error(`${path} is not valid JSON — ${(e as Error).message}`);
  }
  const g = parsed as Partial<Glossary>;
  if (!Array.isArray(g.entries)) {
    throw new Error(`${path}: expected an "entries" array`);
  }
  for (const [i, entry] of g.entries.entries()) {
    if (typeof entry?.term !== "string" || !entry.term.trim()) {
      throw new Error(`${path}: entry ${i} has no "term"`);
    }
    if (typeof entry?.say !== "string") {
      throw new Error(`${path}: entry "${entry.term}" has no "say"`);
    }
  }
  return { version: 1, entries: g.entries };
}

export async function saveGlossary(glossary: Glossary): Promise<string> {
  const path = glossaryPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(glossary, null, 2)}\n`);
  return path;
}

/** Case-insensitive, order-insensitive membership. */
function overlaps(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length === 0) return false;
  const lower = new Set(b.map((s) => s.toLowerCase()));
  return a.some((s) => lower.has(s.toLowerCase()));
}

/**
 * Score an entry against a context, or `null` if it does not apply at all.
 *
 * `null` and `0` are different answers and the distinction is load-bearing:
 * `0` is "this is the unscoped default, use it if nothing better matches",
 * while `null` is "this belongs to some other demo, never use it here".
 */
function score(entry: GlossaryEntry, ctx: GlossaryContext): number | null {
  const when = entry.when;
  if (!when || (!when.hosts?.length && !when.contexts?.length)) return 0;

  let points = 0;
  if (when.contexts?.length) {
    if (!overlaps(when.contexts, ctx.contexts)) return null;
    points += 2;
  }
  if (when.hosts?.length) {
    if (!overlaps(when.hosts, ctx.hosts)) return null;
    points += 1;
  }
  return points;
}

export interface ResolvedTerm {
  entry: GlossaryEntry;
  /** Entries that matched but lost, so `--check` can report ambiguity. */
  shadowed: GlossaryEntry[];
}

/**
 * The entries that apply in this context, one per term, most specific first.
 *
 * Longest term first so a multi-word term wins over a single word inside it —
 * otherwise "Todo" would rewrite half of "Todo List" and leave a hybrid.
 */
export function resolve(
  glossary: Glossary,
  ctx: GlossaryContext,
): ResolvedTerm[] {
  const byTerm = new Map<string, { entry: GlossaryEntry; points: number }[]>();
  for (const entry of glossary.entries) {
    const points = score(entry, ctx);
    if (points === null) continue;
    const key = entry.term.toLowerCase();
    const list = byTerm.get(key) ?? [];
    list.push({ entry, points });
    byTerm.set(key, list);
  }

  const resolved: ResolvedTerm[] = [];
  for (const candidates of byTerm.values()) {
    // Stable: equal scores keep file order, so the first definition wins and
    // the result does not depend on Map iteration details.
    const sorted = [...candidates].sort((a, b) => b.points - a.points);
    const winner = sorted[0];
    if (!winner) continue;
    resolved.push({
      entry: winner.entry,
      shadowed: sorted.slice(1).map((c) => c.entry),
    });
  }
  return resolved.sort((a, b) => b.entry.term.length - a.entry.term.length);
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * Match a whole word, not a fragment.
 *
 * `\b` is applied only at an end that is actually a word character, so a term
 * like "C++" or ".NET" still matches — `\b` next to punctuation asserts the
 * opposite of what you want and would make those terms unmatchable.
 * Without this, "Todo" would also rewrite the middle of "Todoist".
 */
function termPattern(term: string): RegExp {
  const escaped = term.replace(REGEX_SPECIAL, "\\$&");
  const open = /^\w/.test(term) ? "\\b" : "";
  const close = /\w$/.test(term) ? "\\b" : "";
  return new RegExp(`${open}${escaped}${close}`, "gi");
}

export interface Substitution {
  term: string;
  say: string;
  count: number;
}

export interface AppliedGlossary {
  /** The text to hand the synthesiser. */
  spoken: string;
  /** What changed, for the run log and the manifest. */
  substitutions: Substitution[];
}

/** Rewrite one piece of narration for the synthesiser. */
export function applyGlossary(
  text: string,
  resolved: ResolvedTerm[],
): AppliedGlossary {
  let spoken = text;
  const substitutions: Substitution[] = [];

  for (const { entry } of resolved) {
    let count = 0;
    spoken = spoken.replace(termPattern(entry.term), () => {
      count++;
      return entry.say;
    });
    if (count > 0) {
      substitutions.push({ term: entry.term, say: entry.say, count });
    }
  }

  return { spoken, substitutions };
}

/**
 * Every host a storyboard might visit: its `baseUrl`, plus any absolute `goto`.
 *
 * A walk can cross sites mid-demo, and the pronunciation a term needs follows
 * what is on screen rather than where the demo started.
 */
export function hostsOf(
  baseUrl: string | undefined,
  gotos: string[],
): string[] {
  const hosts = new Set<string>();
  for (const candidate of [baseUrl, ...gotos]) {
    if (!candidate) continue;
    try {
      hosts.add(new URL(candidate).hostname);
    } catch {
      // A relative goto resolves against baseUrl, which is already counted.
    }
  }
  return [...hosts];
}
