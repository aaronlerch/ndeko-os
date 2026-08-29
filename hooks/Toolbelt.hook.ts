#!/usr/bin/env bun
/**
 * Toolbelt.hook.ts — SessionStart
 *
 * Reports which structural-search capabilities exist in THIS repo. Inventory
 * only — an environment fact, never a rule about which tool to reach for.
 *
 * WHY THE SPLIT MATTERS, because it is the trap this hook was written to avoid:
 *
 * `~/.claude/doctrine/self-healing.md` bars hooks from encoding *how I work* — which tool I
 * pick, which language, which style — on the grounds that a model reading its
 * own doctrine makes such a hook pointless, and every unnecessary rule competes
 * for attention with the rules that matter. That bar is real and this hook
 * stays under it: the ROUTING rule (structural query → ast-grep, textual query
 * → rg) lives in CLAUDE.md § Operational rules where doctrine belongs. What a
 * hook can supply, and doctrine cannot, is the thing that varies per directory
 * and is otherwise invisible: whether the binary is on PATH here, whether this
 * repo has committed rules, where they are, and how many.
 *
 * Concretely: this hook says "ast-grep is available, 6 rules under
 * .ast-grep/rules". It must never say "use it instead of rg."
 *
 * SILENT WHEN THERE IS NOTHING TO REPORT. A repo with no structural tooling
 * gets zero bytes of injected context, which is the whole point of probing at
 * session start rather than asserting availability in a static file.
 *
 * Fails open in every direction: a probe that throws is treated as "absent".
 * A SessionStart hook cannot block, and a wedged toolbelt probe taking down a
 * session would be far worse than a missing inventory line.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readHookInput } from "./lib/hook-io.ts";

/** Structural-search binaries worth reporting, in the order they are named. */
const BINARIES = ["ast-grep", "comby"] as const;

/** ast-grep reads the first of these it finds at a project root. */
const SG_CONFIG_NAMES = ["sgconfig.yml", "sgconfig.yaml"] as const;

/** MCP server names that plausibly expose language-server semantics. */
const LSP_SERVER_PATTERN = /lsp|serena|language[-_]?server|tsserver/i;

/** Stop walking up at a repo root, and never walk past $HOME. */
function findProjectRoot(start: string): string {
  const home = resolve(homedir());
  let dir = resolve(start);
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir || dir === home) return dir;
    dir = parent;
  }
  return dir;
}

/** Absolute path to the ast-grep config at `root`, or null. */
function findSgConfig(root: string): string | null {
  for (const name of SG_CONFIG_NAMES) {
    const p = join(root, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Parse `ruleDirs:` out of an sgconfig without a YAML dependency.
 *
 * Zero runtime deps is a hard requirement for hooks (see hook-input.ts): they
 * must be importable before `bun install` has ever run in this tree. The
 * grammar here is a block sequence of plain scalars, which is all ast-grep's
 * own docs use for this key, and a miss degrades to "config present, rule
 * count unknown" rather than to a wrong number.
 */
function parseRuleDirs(configText: string): string[] {
  const lines = configText.split("\n");
  const dirs: string[] = [];
  let inKey = false;
  for (const line of lines) {
    if (/^ruleDirs\s*:/.test(line)) {
      inKey = true;
      continue;
    }
    if (!inKey) continue;
    const item = line.match(/^\s+-\s*(.+?)\s*$/);
    if (item?.[1]) {
      dirs.push(item[1].replace(/^["']|["']$/g, ""));
      continue;
    }
    // Any non-indented, non-comment, non-blank line ends the block.
    if (line.trim() !== "" && !line.startsWith("#") && !/^\s/.test(line)) break;
  }
  return dirs;
}

/** Count `.yml`/`.yaml` rule files under a directory, recursively. */
function countRuleFiles(dir: string): number {
  let n = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) n += countRuleFiles(full);
      else if (/\.ya?ml$/.test(entry)) n++;
    } catch {
      // Unreadable entry: skip it rather than abort the count.
    }
  }
  return n;
}

/** MCP servers declared at the project root that look language-server shaped. */
function lspServers(root: string): string[] {
  const p = join(root, ".mcp.json");
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    return Object.keys(parsed.mcpServers ?? {}).filter((name) => LSP_SERVER_PATTERN.test(name));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const input = await readHookInput();
  const cwd = input?.cwd ?? process.cwd();
  const root = findProjectRoot(cwd);

  const facts: string[] = [];

  const found = BINARIES.filter((b) => Bun.which(b) !== null);
  if (found.length > 0) facts.push(`Structural search available on PATH: ${found.join(", ")}.`);

  const configPath = findSgConfig(root);
  if (configPath) {
    let detail = `ast-grep config at ${configPath}`;
    try {
      const dirs = parseRuleDirs(readFileSync(configPath, "utf8"));
      const counted = dirs
        .map((d) => ({ d, n: countRuleFiles(resolve(root, d)) }))
        .filter((x) => x.n > 0);
      if (counted.length > 0) {
        detail += ` — ${counted.map((x) => `${x.n} committed rules under ${x.d}`).join(", ")}`;
      }
    } catch {
      // Config present but unreadable: report the config, drop the count.
    }
    facts.push(`${detail}.`);
  }

  const servers = lspServers(root);
  if (servers.length > 0) {
    facts.push(`Language-server MCP declared at this project root: ${servers.join(", ")}.`);
  }

  // Nothing structural here. Emit nothing: a repo without this tooling should
  // pay zero context for the probe.
  if (facts.length === 0) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `Toolbelt inventory for this repo — ${facts.join(" ")}`,
      },
    }),
  );
  process.exit(0);
}

if (import.meta.main) {
  main().catch(() => process.exit(0)); // fail open: never take down a session
}
