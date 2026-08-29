#!/usr/bin/env bun
/**
 * memory.ts — the mechanical half of memory retirement.
 *
 * `MemoryReconcile.hook.ts` detects that a verdict is owed and asks for one.
 * This performs SUPERSEDE and ARCHIVE so the decision cannot be recorded
 * half-way — a `superseded_by` stamped on a file still sitting in the recall
 * index is worse than no stamp at all, because it looks handled.
 *
 * WHY ARCHIVING MEANS MOVING OUT OF THE TREE
 *
 * Read against Claude Code 2.1.237's own scan (2026-08-20):
 *
 *   - The memory dir is walked RECURSIVELY — a stack over every subtree — and
 *     every `.md` found is indexed for BM25 recall.
 *   - Personal memory has no per-file exclusion. The scan's defaults are
 *     `excludeBasenames: ["MEMORY.md"]`, `maxFiles: 2000`,
 *     `maxFileBytes: 1048576`. `excludePrefixes` is populated only from
 *     team-mount skill dirs, and the recall-visibility predicate returns true
 *     for everything when there are no team mounts.
 *   - Nothing anywhere reads `valid_until` or `superseded_by`. Those are ndeko
 *     conventions and the harness has never heard of them.
 *
 * So `memory/_archive/` would stay fully searchable and a retired fact would go
 * on competing for rank with the fact that replaced it. The archive is a
 * SIBLING directory, and that is the only thing that actually removes a record
 * from recall while keeping it on disk.
 *
 * Past `maxFiles: 2000` the scan keeps the most-recently-modified files and
 * silently drops the rest, so an unpruned store does not merely get slower —
 * old memories stop being indexed at all, with no error.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listMemories } from "../hooks/lib/memory-records.ts";
import { memoryArchiveDir, memoryDir } from "../hooks/lib/paths.ts";

const INDEX_CAP = 2000; // harness scan default, verified 2026-08-20
const BM25_INDEX = ".bm25-index.json"; // the harness's own recall index, if it ever builds

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function die(msg: string): never {
  process.stderr.write(`memory: ${msg}\n`);
  process.exit(1);
}

function memoryPath(slug: string): string {
  return join(memoryDir(), `${slug.replace(/\.md$/, "")}.md`);
}

/** Set a frontmatter key, replacing an existing value or appending the key. */
function setField(content: string, key: string, value: string): string {
  if (!content.startsWith("---\n")) {
    return `---\n${key}: ${value}\n---\n\n${content}`;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) return `---\n${key}: ${value}\n---\n\n${content}`;

  const head = content.slice(4, end);
  const rest = content.slice(end + 1);
  const re = new RegExp(`^${key}\\s*:.*$`, "m");
  const nextHead = re.test(head)
    ? head.replace(re, `${key}: ${value}`)
    : `${head.replace(/\n*$/, "\n")}${key}: ${value}`;
  return `---\n${nextHead.replace(/\n*$/, "\n")}${rest}`;
}

const indexPath = () => join(memoryDir(), "MEMORY.md");

/** Index lines that link to `<slug>.md`. */
function indexLinesFor(slug: string, index: string): string[] {
  return index.split("\n").filter((l) => l.includes(`(${slug}.md)`));
}

function dropIndexLines(slug: string): number {
  const p = indexPath();
  if (!existsSync(p)) return 0;
  const index = readFileSync(p, "utf8");
  const hits = indexLinesFor(slug, index);
  if (hits.length === 0) return 0;
  const kept = index.split("\n").filter((l) => !l.includes(`(${slug}.md)`));
  writeFileSync(p, `${kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "")}\n`, "utf8");
  return hits.length;
}

function retire(slug: string, opts: { supersededBy?: string; reason?: string }): void {
  const src = memoryPath(slug);
  if (!existsSync(src)) die(`no such memory: ${slug} (looked in ${memoryDir()})`);

  if (opts.supersededBy) {
    const replacement = memoryPath(opts.supersededBy);
    if (!existsSync(replacement)) {
      die(`replacement does not exist: ${opts.supersededBy} — refusing to retire ${slug}`);
    }
    if (opts.supersededBy === slug) die("a memory cannot supersede itself");
  }

  let content = readFileSync(src, "utf8");
  content = setField(content, "valid_until", today());
  content = setField(content, "superseded_by", opts.supersededBy ?? "null");
  if (opts.reason) content = setField(content, "retirement_reason", JSON.stringify(opts.reason));

  const dest = join(memoryArchiveDir(), `${slug}.md`);
  if (existsSync(dest)) die(`archive already holds ${slug}.md — resolve by hand`);

  mkdirSync(memoryArchiveDir(), { recursive: true });
  writeFileSync(src, content, "utf8");
  renameSync(src, dest);
  const dropped = dropIndexLines(slug);

  process.stdout.write(
    [
      `retired ${slug}`,
      `  valid_until    ${today()}`,
      `  superseded_by  ${opts.supersededBy ?? "null"}`,
      `  moved to       ${dest}`,
      `  index lines    ${dropped} removed from MEMORY.md`,
      "",
      "It is out of the harness's recall index now — the archive is a sibling of the",
      "memory tree, which is the only placement the recursive scan does not reach.",
      "",
    ].join("\n"),
  );
}

/**
 * Pin or unpin a record.
 *
 * Pinning is the one memory capability that is fully live and ungated. The
 * harness scans memory frontmatter for `metadata.pinned`, keeps the 8 most
 * recently modified pinned records as candidates, and injects the bodies of up
 * to 4 of them at session start. Everything else reaches a session only through
 * its MEMORY.md line.
 *
 * That cap is the reason this is a deliberate act rather than a default: a fifth
 * pin silently displaces the oldest, and a pin costs its full body in every
 * session forever. Pin durable always-relevant facts, not project state that
 * expires.
 *
 * Verified against Claude Code 2.1.237 (`pinnedState`, `metadata.pinned`,
 * candidate cap 8, injected cap 4), 2026-08-20.
 */
const PIN_INJECTED_CAP = 4;

function setPinned(slug: string, pinned: boolean): void {
  const src = memoryPath(slug);
  if (!existsSync(src)) die(`no such memory: ${slug} (looked in ${memoryDir()})`);

  const content = readFileSync(src, "utf8");
  if (!content.startsWith("---\n")) die(`${slug} has no frontmatter — cannot set metadata.pinned`);
  const end = content.indexOf("\n---", 4);
  if (end === -1) die(`${slug} has malformed frontmatter`);

  let head = content.slice(4, end);
  const rest = content.slice(end + 1);

  if (/^\s+pinned\s*:/m.test(head)) {
    head = head.replace(/^(\s+)pinned\s*:.*$/m, `$1pinned: ${pinned}`);
  } else if (/^metadata\s*:/m.test(head)) {
    head = head.replace(/^(metadata\s*:.*)$/m, `$1\n  pinned: ${pinned}`);
  } else {
    head = `${head.replace(/\n*$/, "\n")}metadata:\n  pinned: ${pinned}`;
  }

  writeFileSync(src, `---\n${head.replace(/\n*$/, "\n")}${rest}`, "utf8");

  const pinnedNow = listMemories(memoryDir()).filter((r) => r.pinned).length;
  process.stdout.write(`${pinned ? "pinned" : "unpinned"} ${slug} — ${pinnedNow} pinned total\n`);
  if (pinned && pinnedNow > PIN_INJECTED_CAP) {
    process.stdout.write(
      `warning: ${pinnedNow} records are pinned but only the ${PIN_INJECTED_CAP} most recently\n` +
        "modified get injected. The rest are pinned in name only.\n",
    );
  }
}

function status(): void {
  const records = listMemories(memoryDir());
  const archived = listMemories(memoryArchiveDir());
  const index = existsSync(indexPath()) ? readFileSync(indexPath(), "utf8") : "";

  const slugs = new Set(records.map((r) => r.slug));
  const linked = new Set(
    [...index.matchAll(/\(([^)]+)\.md\)/g)].map((m) => m[1]).filter((s): s is string => !!s),
  );

  const orphanLines = [...linked].filter((s) => !slugs.has(s));
  const unlisted = records.filter((r) => !linked.has(r.slug));
  const retiredInPlace = records.filter((r) => r.retired);

  // Recall index state. The harness builds `.bm25-index.json` in the memory dir
  // ONLY when the server-side flags `tengu_mill_orange` (index recall) and
  // `tengu_moth_copse` (memory recall) are on for the account — both default to
  // false and there is no local override. Without it, memory reaches a session
  // through MEMORY.md and pinned bodies only; nothing searches record bodies.
  // Reporting it here is the difference between a dark feature and an unknown one.
  const bm25 = join(memoryDir(), BM25_INDEX);
  let recall: string;
  if (existsSync(bm25)) {
    let docs = "?";
    try {
      const parsed: unknown = JSON.parse(readFileSync(bm25, "utf8"));
      const d = (parsed as { docs?: unknown }).docs;
      docs = Array.isArray(d) ? String(d.length) : String(Object.keys((d ?? {}) as object).length);
    } catch {
      docs = "unreadable";
    }
    recall = `BUILT — ${BM25_INDEX}, ${docs} docs indexed`;
  } else {
    recall = `absent — no ${BM25_INDEX}; BM25 recall is flag-gated off (see comment)`;
  }

  const lines = [
    `memory dir     ${memoryDir()}`,
    `  records      ${records.length}`,
    `  archived     ${archived.length} (${memoryArchiveDir()})`,
    `  index cap    ${records.length}/${INDEX_CAP} — past the cap the harness keeps the`,
    "               most-recently-modified files and silently drops the rest",
    `  bm25 recall  ${recall}`,
    `  pinned       ${records.filter((r) => r.pinned).length}/${PIN_INJECTED_CAP} injected at session start` +
      `${records.some((r) => r.pinnedMalformed) ? " — WARNING: malformed metadata.pinned value" : ""}`,
    "",
  ];

  if (orphanLines.length) {
    lines.push(`MEMORY.md lines pointing at missing files (${orphanLines.length}):`);
    for (const s of orphanLines) lines.push(`  - ${s}`);
    lines.push("  fix: bun tools/memory.ts reindex --prune");
    lines.push("");
  }
  if (unlisted.length) {
    lines.push(`records with no MEMORY.md line (${unlisted.length}) — invisible at session start:`);
    for (const r of unlisted) lines.push(`  - ${r.slug}`);
    lines.push("");
  }
  if (retiredInPlace.length) {
    lines.push(`retired but still in the recall index (${retiredInPlace.length}):`);
    for (const r of retiredInPlace) lines.push(`  - ${r.slug}  → bun tools/memory.ts archive ${r.slug}`);
    lines.push("");
  }
  if (!orphanLines.length && !unlisted.length && !retiredInPlace.length) {
    lines.push("no inconsistencies.", "");
  }
  process.stdout.write(lines.join("\n"));
}

function reindex(prune: boolean): void {
  const p = indexPath();
  if (!existsSync(p)) die(`no MEMORY.md at ${p}`);
  const slugs = new Set(listMemories(memoryDir()).map((r) => r.slug));
  const index = readFileSync(p, "utf8");
  const keep: string[] = [];
  const dropped: string[] = [];
  for (const line of index.split("\n")) {
    const m = line.match(/\(([^)]+)\.md\)/);
    if (m?.[1] && !slugs.has(m[1])) {
      dropped.push(line.trim());
      continue;
    }
    keep.push(line);
  }
  if (dropped.length === 0) {
    process.stdout.write("MEMORY.md: no orphaned lines.\n");
    return;
  }
  if (!prune) {
    process.stdout.write(
      `MEMORY.md: ${dropped.length} orphaned line(s):\n${dropped.map((d) => `  ${d}`).join("\n")}\n` +
        "re-run with --prune to remove them.\n",
    );
    return;
  }
  writeFileSync(p, `${keep.join("\n").replace(/\n*$/, "")}\n`, "utf8");
  process.stdout.write(`MEMORY.md: pruned ${dropped.length} orphaned line(s).\n`);
}

function usage(): never {
  process.stdout.write(
    [
      "usage: bun tools/memory.ts <command>",
      "",
      "  supersede <slug> --by <slug> [--reason TEXT]",
      "      Retire <slug> because the second record replaces it. Stamps valid_until",
      "      and superseded_by, moves it to the archive, drops its MEMORY.md line.",
      "",
      "  archive <slug> [--reason TEXT]",
      "      Retire <slug> with no replacement (no longer true, never was).",
      "",
      "  pin <slug> | unpin <slug>",
      "      Pin a record so its full body is injected at every session start. Only the",
      `      ${"4"} most recently modified pinned records are injected; a fifth silently`,
      "      displaces the oldest. Pin durable facts, not project state.",
      "",
      "  status",
      "      Record counts, index-cap headroom, and every inconsistency between the",
      "      files on disk and the MEMORY.md index.",
      "",
      "  reindex [--prune]",
      "      Report (or remove) MEMORY.md lines pointing at files that no longer exist.",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) die(`--${name} needs a value`);
  return v;
}

function main(): void {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case "supersede": {
      const slug = argv[1];
      if (!slug || slug.startsWith("--")) die("supersede needs a slug");
      const by = flag(argv, "by");
      if (!by) die("supersede needs --by <slug>");
      retire(slug, { supersededBy: by, reason: flag(argv, "reason") });
      return;
    }
    case "archive": {
      const slug = argv[1];
      if (!slug || slug.startsWith("--")) die("archive needs a slug");
      retire(slug, { reason: flag(argv, "reason") });
      return;
    }
    case "pin":
    case "unpin": {
      const slug = argv[1];
      if (!slug || slug.startsWith("--")) die(`${cmd} needs a slug`);
      setPinned(slug, cmd === "pin");
      return;
    }
    case "status":
      status();
      return;
    case "reindex":
      reindex(argv.includes("--prune"));
      return;
    default:
      usage();
  }
}

if (import.meta.main) main();
