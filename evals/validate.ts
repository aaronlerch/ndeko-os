#!/usr/bin/env bun
/**
 * validate.ts — check the eval suite is well-formed, without running it.
 *
 * WHY THIS EXISTS
 *
 * `claude plugin eval` is early access, enabled per organization, and is NOT
 * enabled on this account — it prints "`plugin eval` is currently in early
 * access" and does nothing. So the suite cannot be executed here yet, and an
 * unrunnable suite is exactly the kind of artifact that rots silently: a typo in
 * a grader type or an uncompilable regex would sit undiscovered until the day
 * access lands and someone needs a result.
 *
 * This validates everything that can be checked without inference: structure,
 * required fields per grader type, regex compilation, and the `EVAL_*` env rule.
 * It is a gate that works today for a feature that arrives later.
 *
 * The schema it checks is the one embedded in the Claude Code 2.1.237 binary's
 * own plugin-eval reference, read 2026-08-20. If the format moves, this file is
 * where the drift shows up first.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const SUITE = import.meta.dir;

/** Grader types the runner accepts, with the fields each one requires. */
const GRADER_TYPES: Record<string, string[]> = {
  regex: ["pattern"],
  tool_used: ["tool"],
  tool_order: ["before", "after"],
  file_exists: ["path"],
  llm: ["criteria"],
  baseline: ["baseline_file", "criteria"],
};

const PROMPT_KEYS = new Set([
  "name", "tags", "plugins", "runs", "max_turns",
  "timeout_seconds", "allowed_tools", "model", "append_system_prompt", "env",
]);

interface Front {
  keys: Map<string, string>;
  raw: string;
}

/**
 * Frontmatter reader, deliberately shallow.
 *
 * It reads top-level `key:` lines and the presence of nested blocks; it does not
 * build a full YAML tree. That is enough for every check here and keeps the
 * validator dependency-free, which matters because it should run before
 * `bun install` in a fresh clone.
 */
function frontmatter(file: string): Front | null {
  const text = readFileSync(file, "utf8");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const raw = text.slice(4, end);
  const keys = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const m = line.match(/^([a-z_]+)\s*:\s*(.*)$/);
    if (m?.[1]) keys.set(m[1], (m[2] ?? "").trim());
  }
  return { keys, raw };
}

const problems: string[] = [];
const notes: string[] = [];

function checkCase(dir: string): void {
  const name = basename(dir);
  const promptPath = join(dir, "prompt.md");
  const caseYaml = join(dir, "case.yaml");

  if (!existsSync(promptPath) && !existsSync(caseYaml)) {
    problems.push(`${name}: no prompt.md and no case.yaml`);
    return;
  }

  if (existsSync(promptPath)) {
    const fm = frontmatter(promptPath);
    if (!fm) {
      problems.push(`${name}/prompt.md: missing or malformed frontmatter`);
      return;
    }
    const declared = fm.keys.get("name");
    if (!declared) problems.push(`${name}/prompt.md: frontmatter has no \`name\``);
    else if (declared !== name) {
      problems.push(`${name}/prompt.md: name is "${declared}" but the folder is "${name}"`);
    }
    for (const k of fm.keys.keys()) {
      if (!PROMPT_KEYS.has(k)) notes.push(`${name}/prompt.md: unrecognized key \`${k}\``);
    }
    // Case env keys must be EVAL_*.
    if (fm.raw.includes("env:")) {
      const envBlock = fm.raw.slice(fm.raw.indexOf("env:"));
      for (const m of envBlock.matchAll(/^\s+([A-Z_][A-Z0-9_]*)\s*:/gm)) {
        if (m[1] && !m[1].startsWith("EVAL_")) {
          problems.push(`${name}/prompt.md: env key \`${m[1]}\` must start with EVAL_`);
        }
      }
    }
    const body = readFileSync(promptPath, "utf8").split(/\n---\n/).slice(1).join("\n---\n").trim();
    if (!body) problems.push(`${name}/prompt.md: no prompt body below the frontmatter`);
  }

  const graderDir = join(dir, "graders");
  if (!existsSync(graderDir)) {
    problems.push(`${name}: no graders/ directory — a case with no grader scores nothing`);
    return;
  }
  const graders = readdirSync(graderDir).filter((f) => f.endsWith(".md"));
  if (graders.length === 0) {
    problems.push(`${name}/graders: empty`);
    return;
  }

  for (const g of graders) {
    const gp = join(graderDir, g);
    const fm = frontmatter(gp);
    if (!fm) {
      problems.push(`${name}/graders/${g}: missing or malformed frontmatter`);
      continue;
    }
    const type = fm.keys.get("type");
    if (!type) {
      problems.push(`${name}/graders/${g}: no \`type\``);
      continue;
    }
    const required = GRADER_TYPES[type];
    if (!required) {
      problems.push(
        `${name}/graders/${g}: unknown type "${type}" — expected one of ${Object.keys(GRADER_TYPES).join(", ")}`,
      );
      continue;
    }
    for (const field of required) {
      // `criteria` and `pattern` may be block scalars; presence of the key is the test.
      if (!fm.keys.has(field)) {
        problems.push(`${name}/graders/${g}: type ${type} requires \`${field}\``);
      }
    }
    if (type === "regex") {
      const pattern = fm.keys.get("pattern") ?? "";
      if (pattern) {
        try {
          new RegExp(pattern);
        } catch (err) {
          problems.push(
            `${name}/graders/${g}: pattern does not compile — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      const match = fm.keys.get("match");
      if (match && !/^(contains|not_contains|count:\d+)$/.test(match)) {
        problems.push(`${name}/graders/${g}: match must be contains | not_contains | count:N`);
      }
    }
    if (type === "tool_used") {
      for (const k of ["min", "max"]) {
        const v = fm.keys.get(k);
        if (v !== undefined && !/^\d+$/.test(v)) {
          problems.push(`${name}/graders/${g}: ${k} must be an integer`);
        }
      }
    }
  }
}

function main(): void {
  const cases = readdirSync(SUITE)
    .map((n) => join(SUITE, n))
    .filter((p) => {
      try {
        return statSync(p).isDirectory() && basename(p) !== "results";
      } catch {
        return false;
      }
    });

  if (cases.length === 0) {
    process.stderr.write("evals: no case directories found\n");
    process.exit(1);
  }

  for (const c of cases) checkCase(c);

  const graderCount = cases.reduce((n, c) => {
    const gd = join(c, "graders");
    return n + (existsSync(gd) ? readdirSync(gd).filter((f) => f.endsWith(".md")).length : 0);
  }, 0);

  for (const n of notes) process.stdout.write(`note: ${n}\n`);

  if (problems.length) {
    process.stderr.write(`\nevals: ${problems.length} problem(s)\n`);
    for (const p of problems) process.stderr.write(`  ✗ ${p}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `evals: ${cases.length} cases, ${graderCount} graders — all well-formed.\n` +
      "Structure only. Nothing here has been executed: `claude plugin eval` is early\n" +
      "access and not enabled on this account.\n",
  );
}

if (import.meta.main) main();
