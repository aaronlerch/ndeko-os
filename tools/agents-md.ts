#!/usr/bin/env bun
/**
 * agents-md.ts — generate AGENTS.md from the doctrine files.
 *
 * WHY
 *
 * AGENTS.md is Linux-Foundation-stewarded, read by 28+ tools across 60,000+
 * public repos, and Claude Code is the explicit holdout. This system's entire
 * doctrine lives in files that only Claude Code loads. That is fine while the
 * subscription constraint holds and stops being fine the moment it doesn't —
 * and the billing landscape is the single thing this setup is most exposed to.
 *
 * So: a build artifact, not a second source of truth. `CLAUDE.md`,
 * `system-prompt.md`, and `assistant.md` stay authoritative; AGENTS.md is
 * derived from them and regenerated, never hand-edited. Codex CLI (the
 * second-vendor arm this system already uses for Forge) reads it natively.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not translate, summarize, or reinterpret the doctrine — no model runs
 * here. Anything that rewrote the rules on the way through would be a second
 * doctrine that drifts, which is worse than no portability at all. It inlines
 * `@`-imports (AGENTS.md consumers have no import mechanism) and adds a header
 * saying where the content came from. That is the whole transformation.
 *
 * A stale artifact is the failure mode, so `--check` compares a digest of the
 * sources against the one stamped in the file and exits 1 on drift.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { agentsMdFile, assistantFile, claudeMdFile, harnessPath, harnessRoot, systemPromptFile } from "../hooks/lib/paths.ts";

const DIGEST_MARKER = "<!-- ndeko:sources-digest ";

interface Source {
  path: string;
  label: string;
  /** What this file is, in the generated file's own words. */
  note: string;
}

function sources(): Source[] {
  return [
    {
      path: systemPromptFile(),
      label: "system-prompt.md",
      note: "Constitutional rules. These outrank everything below them.",
    },
    {
      path: assistantFile(),
      label: "assistant.md",
      note: "Identity and voice.",
    },
    {
      path: claudeMdFile(),
      label: "CLAUDE.md",
      note: "Routing table and operational rules.",
    },
    {
      // The one doctrine file that belongs in the portable artifact: every harness
      // authors skills and instruction files, so this is the doctrine whose absence
      // would be felt identically in all of them. The others (verification,
      // self-healing, philosophy) stay Claude-Code-only and on-demand.
      path: harnessPath("doctrine", "authoring.md"),
      label: "doctrine/authoring.md",
      note: "How to write any document an agent consumes.",
    },
  ];
}

/**
 * Inline `@path` imports one level deep.
 *
 * One level is deliberate: the import graph here is flat by design, and a
 * recursive inliner would silently duplicate content the moment that stopped
 * being true. If a nested import ever appears, this leaves it visible as an
 * unresolved `@` line rather than quietly producing a wrong file.
 */
function inlineImports(content: string, baseDir: string, alreadyIncluded: Set<string>): string {
  return content
    .split("\n")
    .map((line) => {
      const m = line.match(/^@(\S+)\s*$/);
      if (!m?.[1]) return line;
      const target = join(baseDir, m[1]);
      const name = basename(target);
      if (alreadyIncluded.has(name)) {
        return `<!-- ${name} appears in this file under its own heading -->`;
      }
      if (!existsSync(target)) return line;
      alreadyIncluded.add(name);
      return `<!-- inlined from ${name} -->\n\n${readFileSync(target, "utf8").trim()}`;
    })
    .join("\n");
}

function digestOf(srcs: Source[]): string {
  const h = createHash("sha256");
  for (const s of srcs) {
    h.update(s.label);
    h.update(existsSync(s.path) ? readFileSync(s.path, "utf8") : "");
  }
  return h.digest("hex").slice(0, 16);
}

function render(): string {
  const srcs = sources();
  const included = new Set(srcs.map((s) => s.label));
  const digest = digestOf(srcs);

  const parts: string[] = [
    "# AGENTS.md",
    "",
    "**Generated file — do not edit.**",
    "",
    "Regenerate with `bun tools/agents-md.ts`. The authoritative sources are the files",
    "named in each section heading; edit those. This artifact exists so the doctrine is",
    "readable by agent tools that do not load Claude Code's config — the second-vendor",
    "arm this system already depends on, and any harness it might have to move to.",
    "",
    `${DIGEST_MARKER}${digest} -->`,
    "",
    "---",
    "",
  ];

  for (const s of srcs) {
    if (!existsSync(s.path)) continue;
    const body = inlineImports(readFileSync(s.path, "utf8").trim(), dirname(s.path), included);
    parts.push(`## From \`${s.label}\``, "", `> ${s.note}`, "", body, "", "---", "");
  }

  parts.push(
    "*Personal content — identity, goals, memory — lives outside this repository and is",
    "deliberately absent here.*",
    "",
  );

  return parts.join("\n");
}

function stampedDigest(): string | null {
  const p = agentsMdFile();
  if (!existsSync(p)) return null;
  const m = readFileSync(p, "utf8").match(/<!-- ndeko:sources-digest ([0-9a-f]+) -->/);
  return m?.[1] ?? null;
}

function main(): void {
  const check = process.argv.includes("--check");
  const want = digestOf(sources());
  const have = stampedDigest();

  if (check) {
    if (have === want) {
      process.stdout.write(`AGENTS.md is current (${want}).\n`);
      process.exit(0);
    }
    process.stderr.write(
      have === null
        ? `AGENTS.md is missing. Run: bun tools/agents-md.ts\n`
        : `AGENTS.md is stale (has ${have}, sources are ${want}). Run: bun tools/agents-md.ts\n`,
    );
    process.exit(1);
  }

  const out = render();
  writeFileSync(agentsMdFile(), out, "utf8");
  const rel = agentsMdFile().replace(`${harnessRoot()}/`, "");
  process.stdout.write(`wrote ${rel} — ${out.length} bytes, sources digest ${want}\n`);
}

if (import.meta.main) main();
