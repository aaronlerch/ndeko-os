#!/usr/bin/env bun
/**
 * PrivacyBoundary.hook.ts — PreToolUse on Write | Edit | MultiEdit
 *
 * The harness tree is a git repo that can be cloned to any machine; the data
 * tree is machine-local and holds everything personal. That split IS the privacy
 * enforcement, and it only holds while nothing personal drifts across it.
 *
 * This hook is the mechanical half of that rule. It is the sanctioned hook class
 * from `~/.claude/doctrine/self-healing.md`: a checkable property of an artifact.
 * It does not encode *how I work* — a capable model reading its own doctrine
 * makes that kind of hook pointless. It checks the one thing prose cannot, which
 * is whether the bytes about to land in a shareable repo contain a term that must
 * never be in one.
 *
 * WHERE THE DENYLIST LIVES, AND WHY IT IS NOT IN THIS FILE
 *
 * The terms are employer names, customer names, internal repo and project names.
 * Writing them here would put the very strings this hook exists to exclude into
 * the repo it is protecting. So the list lives in the data tree at
 * `privacy-denylist.txt`, and this file ships empty of them.
 *
 * FAILURE MODE, CHOSEN DELIBERATELY
 *
 * No denylist means no term checks — the structural checks still run. The harness
 * must work on a machine that has no data tree yet (a fresh clone, a worktree, an
 * eval sandbox), and a hook that hard-failed there would make the tree unusable
 * rather than safe. The gap is announced on stderr, never silent.
 *
 * This is a tripwire, not a guarantee. It catches known strings and two
 * structural patterns. It cannot catch a paraphrase, and nothing here replaces
 * reading the diff.
 */

import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { readHookInput, block } from "./lib/hook-io.ts";
import { dataPath, harnessRoot } from "./lib/paths.ts";

/** One term per line. `#` starts a comment. Blank lines ignored. */
export const denylistFile = (): string => dataPath("privacy-denylist.txt");

export interface Hit {
  label: string;
  match: string;
  /** 1-indexed line within the scanned text. */
  line?: number;
}

/**
 * Structural patterns that are safe to name in the open, because they describe a
 * SHAPE rather than a person: a home directory carrying someone's username, and
 * a bare private-key block. Personal strings never appear here.
 */
const STRUCTURAL: Array<{ label: string; re: RegExp }> = [
  {
    label: "machine-specific home path (use ~/ instead)",
    re: /\/(?:Users|home)\/(?!\*)[A-Za-z][\w.-]{1,31}\//,
  },
  {
    label: "private key block",
    re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  },
];

/** Parse the denylist. Returns [] when the file is absent or unreadable. */
export function loadDenylist(path = denylistFile()): string[] {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/** Word-boundary match when the term is alphanumeric; substring otherwise. */
function termMatches(text: string, term: string): string | null {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordish = /^[\w-]+$/.test(term);
  const re = new RegExp(wordish ? `\\b${escaped}\\b` : escaped, "i");
  return text.match(re)?.[0] ?? null;
}

/**
 * Suppresses the STRUCTURAL patterns on the line it appears on, or on the line
 * immediately below it — the way a linter's disable comment works.
 *
 * WHY STRUCTURAL ONLY, AND WHY THIS EXISTS AT ALL
 *
 * The structural patterns describe a *shape* — a home path, a key block — and
 * some files legitimately need to write that shape down: the test suite for this
 * very hook, the scanner's own tests, and documentation showing what a violation
 * looks like. Without an escape hatch a detector cannot be tested, which is how
 * you end up with a gate nobody has ever seen fire.
 *
 * Denylisted terms are NOT exemptible. Those are real names, and no amount of
 * commenting makes a real name belong in a public repo. The asymmetry is the
 * whole point: a shape is safe to write, an identity is not.
 */
const INLINE_ALLOW = /privacy-gate:allow/;

export function scan(text: string, denylist: string[]): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split("\n");

  lines.forEach((line, i) => {
    const exempt = INLINE_ALLOW.test(line) || (i > 0 && INLINE_ALLOW.test(lines[i - 1]!));
    if (!exempt) {
      for (const { label, re } of STRUCTURAL) {
        const m = line.match(re);
        if (m) hits.push({ label, match: m[0], line: i + 1 });
      }
    }
    for (const term of denylist) {
      const m = termMatches(line, term);
      if (m) hits.push({ label: "denylisted term", match: m, line: i + 1 });
    }
  });

  return hits;
}

/**
 * True when the path is inside the harness tree AND in a location that actually
 * ships. Private skills (`skills/_*`) are gitignored by design and exist to hold
 * exactly this kind of content, so they are exempt.
 */
export function isProtected(filePath: string, root = harnessRoot()): boolean {
  const rel = relative(resolve(root), resolve(filePath));
  if (!rel || rel.startsWith("..") || rel.startsWith(sep)) return false;
  const parts = rel.split(sep);
  if (parts[0] === "skills" && parts[1]?.startsWith("_")) return false;
  return true;
}

/**
 * Pull every piece of text this tool call would write. Keyed on the shape of the
 * payload rather than the tool name, so a new write-shaped tool is covered the
 * moment its matcher is added, with no change here.
 */
export function writtenText(input: Record<string, unknown>): string {
  const chunks: string[] = [];
  if (typeof input.content === "string") chunks.push(input.content);
  if (typeof input.new_string === "string") chunks.push(input.new_string);
  if (Array.isArray(input.edits)) {
    for (const e of input.edits) {
      if (e && typeof e === "object" && typeof (e as { new_string?: unknown }).new_string === "string") {
        chunks.push((e as { new_string: string }).new_string);
      }
    }
  }
  return chunks.join("\n");
}

async function main(): Promise<void> {
  const input = await readHookInput();
  if (!input?.tool_input) process.exit(0);

  const filePath = input.tool_input.file_path;
  if (typeof filePath !== "string" || !isProtected(filePath)) process.exit(0);

  const text = writtenText(input.tool_input);
  if (!text.trim()) process.exit(0);

  const denylist = loadDenylist();
  const hits = scan(text, denylist);

  if (!hits.length) {
    if (!denylist.length) {
      process.stderr.write(
        `PrivacyBoundary: no denylist at ${denylistFile()} — structural checks only, term checks skipped.\n`,
      );
    }
    process.exit(0);
  }

  const lines = hits.map((h) => `  - ${h.label}: "${h.match}"`).join("\n");
  block(
    `PrivacyBoundary: blocked a write to the harness tree.\n\n` +
      `  file: ${filePath}\n${lines}\n\n` +
      `The harness is a clonable repo and must carry nothing personal. Move this content to ` +
      `the data tree, put it in a private skill (skills/_*), or rewrite it generically. ` +
      `If the match is a false positive, the denylist is at ${denylistFile()}.`,
  );
}

if (import.meta.main) await main();
