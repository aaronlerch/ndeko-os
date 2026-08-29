/**
 * memory-records.ts — reading memory files and scoring how much two of them overlap.
 *
 * Shared by `MemoryReconcile.hook.ts` (detects the near-duplicate) and
 * `tools/memory.ts` (performs the retirement). Zero runtime dependencies, same
 * requirement as every other file under hooks/: a hook must load before
 * `bun install` has ever run in this tree.
 *
 * WHY LEXICAL AND NOT SEMANTIC
 *
 * The obvious objection is that Dice overlap on tokens misses a paraphrase, and
 * that is true. It is also the correct trade here. This scorer's only job is to
 * decide whether to *ask a question*; the judgment call — is this genuinely the
 * same fact, and which one wins — belongs to the model reading the candidates,
 * which does not have the paraphrase problem. A deterministic detector that
 * fires slightly too often costs a sentence of context. A model-based detector
 * on the write path costs an inference call per memory write and can fail
 * silently, which is the failure mode this whole subsystem exists to avoid.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface MemoryRecord {
  /** Absolute path on disk. */
  path: string;
  /** Basename without the .md — the slug the MEMORY.md index links to. */
  slug: string;
  /** Raw frontmatter block, without the --- fences. Empty when there is none. */
  frontmatter: string;
  /** Everything after the frontmatter. */
  body: string;
  /** `name:` from frontmatter, falling back to the slug. */
  name: string;
  /** `description:` from frontmatter, unquoted. Empty when absent. */
  description: string;
  /** True when `valid_until` holds anything other than null — already retired. */
  retired: boolean;
  /**
   * `metadata.pinned` is truthy — the harness injects this record's full body at
   * session start (subject to its 4-record cap).
   */
  pinned: boolean;
  /** `metadata.pinned` is present but is not a value the harness can parse. */
  pinnedMalformed: boolean;
}

/** Words carrying no discriminating signal in a memory record. */
const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "was", "were", "are", "but", "not",
  "you", "your", "our", "its", "has", "have", "had", "can", "will", "would", "should",
  "when", "what", "which", "who", "how", "why", "all", "any", "each", "than", "then",
  "there", "their", "into", "over", "under", "after", "before", "while", "also",
  "one", "two", "now", "new", "old", "get", "got", "set", "run", "ran", "use", "used",
  "still", "just", "only", "same", "other", "some", "more", "most", "such", "does", "did",
]);

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith("---\n")) return { frontmatter: "", body: content };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: "", body: content };
  return { frontmatter: content.slice(4, end), body: content.slice(end + 4) };
}

function field(frontmatter: string, key: string): string {
  const m = frontmatter.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, "m"));
  if (!m?.[1]) return "";
  return m[1].trim().replace(/^["']|["']$/g, "").trim();
}

export function parseMemory(path: string): MemoryRecord | null {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const { frontmatter, body } = splitFrontmatter(content);
  const slug = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  const validUntil = field(frontmatter, "valid_until");

  // The harness reads `metadata.pinned` and accepts a boolean, or a string/number
  // it can coerce. Anything else it counts as malformed rather than silently
  // false, so we surface that distinction too.
  const pinnedRaw = frontmatter.match(/^\s+pinned\s*:\s*(.*)$/m)?.[1]?.trim().toLowerCase();
  const truthy = ["true", "1", "yes", "on"];
  const falsy = ["false", "0", "no", "off"];

  return {
    path,
    slug,
    frontmatter,
    body,
    name: field(frontmatter, "name") || slug,
    description: field(frontmatter, "description"),
    retired: validUntil !== "" && validUntil !== "null",
    pinned: pinnedRaw !== undefined && truthy.includes(pinnedRaw),
    pinnedMalformed:
      pinnedRaw !== undefined && !truthy.includes(pinnedRaw) && !falsy.includes(pinnedRaw),
  };
}

/**
 * Every memory record in a directory, non-recursively.
 *
 * Non-recursive on purpose and it differs from the harness here: the harness
 * walks subtrees, but nothing in ndeko writes memory into one, and a recursive
 * walk would make this scorer quadratic over a tree it does not own.
 */
export function listMemories(dir: string): MemoryRecord[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: MemoryRecord[] = [];
  for (const n of names) {
    if (!n.endsWith(".md") || n === "MEMORY.md") continue;
    const p = join(dir, n);
    try {
      if (!statSync(p).isFile()) continue;
    } catch {
      continue;
    }
    const rec = parseMemory(p);
    if (rec) out.push(rec);
  }
  return out;
}

export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/** Sørensen–Dice over two token sets. 0 when either is empty. */
export function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/**
 * How much two memory records overlap, 0..1.
 *
 * The head (name + description) is weighted over the body because that is what
 * the MEMORY.md index carries and therefore what a future session actually
 * reads first. Two records with near-identical descriptions are a duplicate
 * even when their bodies diverge — that is precisely the case where the index
 * will offer both and the reader cannot tell which is current.
 */
export function similarity(a: MemoryRecord, b: MemoryRecord): number {
  const head = dice(tokenize(`${a.name} ${a.description}`), tokenize(`${b.name} ${b.description}`));
  const body = dice(tokenize(a.body), tokenize(b.body));
  return 0.6 * head + 0.4 * body;
}

/** Score at or above which a pair is worth an explicit verdict. */
export const RECONCILE_THRESHOLD = 0.35;

export interface Candidate {
  record: MemoryRecord;
  score: number;
}

/** Existing records similar enough to the subject to need a verdict, best first. */
export function findCandidates(
  subject: MemoryRecord,
  pool: MemoryRecord[],
  threshold = RECONCILE_THRESHOLD,
): Candidate[] {
  return pool
    .filter((r) => r.path !== subject.path && !r.retired)
    .map((record) => ({ record, score: similarity(subject, record) }))
    .filter((c) => c.score >= threshold)
    .sort((x, y) => y.score - x.score);
}
