#!/usr/bin/env bun
/**
 * paths.ts — the SINGLE path authority for ndeko.
 *
 * WHY THIS FILE EXISTS, AND WHY IT LOOKS LIKE THIS
 *
 * The upstream system this replaces had three competing path mechanisms and ~25
 * hardcoded `.claude` literals across 11 files. The dangerous class was the
 * hardcoded one: under a renamed config root those sites kept resolving to the
 * OLD tree and wrote there silently — no error, no warning, just state landing
 * in the wrong place. One hook (`ISASync`) imported a correct helper AND
 * hand-wrote three paths, so it wrote to two trees simultaneously.
 *
 * The fix is to remove the possibility rather than police it:
 *
 *   1. The harness root is DERIVED FROM THIS MODULE'S OWN LOCATION. This file
 *      always lives at <harnessRoot>/hooks/lib/paths.ts, so `../..` from here
 *      IS the root. No literal to get stale, no env var required, and a rename
 *      of the whole tree is a no-op — proven in practice: a full rename of
 *      this tree moved every hook, test and tool without one path helper
 *      changing. `~/.ndeko-os` on disk, `~/.claude` through the install
 *      symlink, `/tmp/scratch-clone` in a portability test — all correct with
 *      zero changes here.
 *
 *   2. The data root comes from ONE env var with an explicit fallback chain.
 *      It cannot be derived (it is deliberately outside the harness tree so a
 *      `git clean -xdf` cannot destroy memory), so it is named once here and
 *      set once in settings.json `env`.
 *
 * RULE: no other file in this tree may contain a config-root path literal.
 * `rg -n '\.claude|\.ndeko-os|\.config/ndeko' --type ts` outside this file
 * must return zero hits. `tools/PathGate.ts` is that gate, run in CI.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Env var that overrides the harness root. Set by the harness itself. */
const HARNESS_ENV = "CLAUDE_CONFIG_DIR";

/** Env var that locates the private data tree. Set in settings.json `env`. */
const DATA_ENV = "NDEKO_DATA_DIR";

/**
 * Where the data tree lives when DATA_ENV is unset. One location, no legacy
 * aliases: a second name that resolves to the same tree is the ambiguity this
 * module exists to remove.
 */
const DATA_DEFAULT = join(".config", "ndeko-os");
const DATA_FALLBACKS: readonly string[] = [DATA_DEFAULT];

/** Expand a leading `~` or `$HOME` / `${HOME}` in a configured path. */
function expandHome(p: string): string {
  const home = homedir();
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p.replace(/^\$\{?HOME\}?(?=\/|$)/, home);
}

/**
 * The harness root — the directory holding CLAUDE.md, settings.json, hooks/,
 * skills/, algorithm/, doctrine/, tools/.
 *
 * Resolution order:
 *   1. CLAUDE_CONFIG_DIR, when the harness sets it (side-by-side testing).
 *   2. Self-location from this module. Always correct; the normal path.
 */
export function harnessRoot(): string {
  const fromEnv = process.env[HARNESS_ENV];
  if (fromEnv && fromEnv.trim()) return resolve(expandHome(fromEnv.trim()));
  // <root>/hooks/lib/paths.ts → <root>
  return resolve(import.meta.dir, "..", "..");
}

/**
 * The data root — private, machine-local, deliberately OUTSIDE the harness
 * tree so that cleaning or re-cloning the harness cannot destroy memory.
 *
 * Resolution order:
 *   1. NDEKO_DATA_DIR.
 *   2. First fallback that already exists on disk.
 *   3. First fallback, whether it exists or not (so callers can create it).
 */
export function dataRoot(): string {
  const fromEnv = process.env[DATA_ENV];
  if (fromEnv && fromEnv.trim()) return resolve(expandHome(fromEnv.trim()));
  const home = homedir();
  for (const rel of DATA_FALLBACKS) {
    const candidate = join(home, rel);
    if (existsSync(candidate)) return candidate;
  }
  return join(home, DATA_DEFAULT);
}

/** Join under the harness root. */
export function harnessPath(...parts: string[]): string {
  return join(harnessRoot(), ...parts);
}

/** Join under the data root. */
export function dataPath(...parts: string[]): string {
  return join(dataRoot(), ...parts);
}

// ─── Harness locations ──────────────────────────────────────────────────────

export const hooksDir = () => harnessPath("hooks");
export const hooksLibDir = () => harnessPath("hooks", "lib");
export const skillsDir = () => harnessPath("skills");
export const agentsDir = () => harnessPath("agents");
export const toolsDir = () => harnessPath("tools");
export const algorithmDir = () => harnessPath("algorithm");
export const doctrineDir = () => harnessPath("doctrine");
export const evalsDir = () => harnessPath("evals");
export const docsDir = () => harnessPath("docs");

export const settingsFile = () => harnessPath("settings.json");
export const hookManifestFile = () => harnessPath("hooks.json");
export const claudeMdFile = () => harnessPath("CLAUDE.md");
export const systemPromptFile = () => harnessPath("system-prompt.md");
export const assistantFile = () => harnessPath("assistant.md");
export const agentsMdFile = () => harnessPath("dist", "AGENTS.md");

/**
 * Current algorithm doctrine file, resolved through algorithm/LATEST.
 * Sync on purpose — hooks call this from non-async paths.
 * Returns null rather than throwing: a missing doctrine file is a degraded
 * state to report, not a reason to take down a hook.
 */
export function algorithmFile(): string | null {
  const latest = join(algorithmDir(), "LATEST");
  if (!existsSync(latest)) return null;
  const version = readFileSync(latest, "utf8").trim();
  if (!version) return null;
  const candidate = join(algorithmDir(), `v${version}.md`);
  return existsSync(candidate) ? candidate : null;
}

// ─── Data locations ─────────────────────────────────────────────────────────

export const memoryDir = () => dataPath("memory");
export const identityDir = () => dataPath("identity");
export const stateDir = () => dataPath("state");

/**
 * Where retired memories go. A SIBLING of the memory tree, never a subdirectory
 * of it, and that is the whole point.
 *
 * The harness walks the memory dir recursively (stack-based, every subtree) and
 * indexes every `.md` it finds for BM25 recall. Personal memory has no
 * per-file exclusion mechanism — `excludeBasenames` is exactly `["MEMORY.md"]`
 * and `excludePrefixes` is populated only from team-mount skill dirs. So a
 * `memory/_archive/` would still be fully searchable, and a superseded fact
 * would keep competing for rank against the fact that replaced it.
 *
 * Verified against Claude Code 2.1.237's own scan defaults, 2026-08-20.
 */
export const memoryArchiveDir = () => dataPath("memory-archive");

export const goalsFile = () => dataPath("goals.md");
export const principalFile = () => dataPath("identity", "principal.md");
export const voiceFile = () => dataPath("identity", "voice.md");
export const configFile = () => dataPath("config.toml");
export const envFile = () => dataPath(".env");

/**
 * Local dev-channel registry, read by the launcher's -D flag.
 *
 * Data tree rather than harness on purpose: every entry is an absolute path
 * into a checkout on THIS machine, which is exactly what the privacy boundary
 * keeps out of a clonable repo.
 */
export const devChannelsFile = () => dataPath("dev-channels.json");

// ─── Introspection ──────────────────────────────────────────────────────────

export interface RootReport {
  harnessRoot: string;
  harnessSource: "env" | "self-located";
  dataRoot: string;
  dataSource: "env" | "existing-fallback" | "default-fallback";
  harnessExists: boolean;
  dataExists: boolean;
}

/** Report how both roots resolved. Used by the launcher and the doctor check. */
export function describeRoots(): RootReport {
  const harnessFromEnv = Boolean(process.env[HARNESS_ENV]?.trim());
  const dataFromEnv = Boolean(process.env[DATA_ENV]?.trim());
  const dr = dataRoot();
  let dataSource: RootReport["dataSource"] = "default-fallback";
  if (dataFromEnv) dataSource = "env";
  else if (existsSync(dr)) dataSource = "existing-fallback";
  return {
    harnessRoot: harnessRoot(),
    harnessSource: harnessFromEnv ? "env" : "self-located",
    dataRoot: dr,
    dataSource,
    harnessExists: existsSync(harnessRoot()),
    dataExists: existsSync(dr),
  };
}

if (import.meta.main) {
  const r = describeRoots();
  console.log(`harness  ${r.harnessRoot}`);
  console.log(`         via ${r.harnessSource}${r.harnessExists ? "" : "  [MISSING]"}`);
  console.log(`data     ${r.dataRoot}`);
  console.log(`         via ${r.dataSource}${r.dataExists ? "" : "  [MISSING]"}`);
  const algo = algorithmFile();
  console.log(`algorithm ${algo ?? "[unresolved]"}`);
}
