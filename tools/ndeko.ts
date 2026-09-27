#!/usr/bin/env bun
/**
 * ndeko.ts — launcher.
 *
 * Primary job: run a Claude Code session against THIS tree while the live
 * `~/.claude` install stays untouched and fully working. That side-by-side
 * property is what makes the staging-then-rename plan testable at all.
 *
 * Secondary job, and non-negotiable: protect the billing path. A `--bare`
 * invocation (or a stray ANTHROPIC_API_KEY in the environment) forces API-key
 * auth instead of the OAuth subscription. That exact mistake has already
 * produced a four-figure API bill in a single month. This launcher strips all
 * three carrier vars before spawn and refuses to pass --bare at all.
 *
 * TWO MODES
 *
 *   config-dir (default)
 *     Sets CLAUDE_CONFIG_DIR to this tree, so the harness reads settings,
 *     hooks, skills and agents from here. Most faithful to what the
 *     post-rename install will be.
 *     KNOWN LIMITS with CLAUDE_CONFIG_DIR set (verified against 2.1.233):
 *       - `claude service install` refuses (the launchd unit is a per-user
 *         singleton supporting only the default config dir)
 *       - the on-demand background daemon is disabled
 *       - SDK transcript-mirroring warns when a child's value differs
 *
 *   flags
 *     Leaves CLAUDE_CONFIG_DIR unset and composes the session from explicit
 *     flags. Use when the background daemon or a service matters. Trades
 *     fidelity for capability: settings come from --settings, so anything the
 *     harness reads by convention from the config dir will not load.
 *
 * FLAGS OF ITS OWN
 *
 *   Everything not listed here is forwarded to `claude` verbatim, so claude's
 *   own flags (-w/--worktree, --tmux, -r/--resume, -c) just work — and so does a
 *   subcommand: `ndeko remote-control --spawn worktree` starts Remote Control
 *   with the billing carriers stripped, and the sessions it starts get the
 *   doctrine from the output style.
 *
 *   --config-dir | --flags   pick a mode (above)
 *   -n | --dry-run           print the composed argv and exit
 *   -D <name>...             local dev channel — see runDevChannels
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  algorithmFile,
  describeRoots,
  devChannelsFile,
  harnessRoot,
  settingsFile,
  skillsDir,
  systemPromptFile,
} from "../hooks/lib/paths.ts";

/** Env vars that switch billing away from the OAuth subscription. */
const BILLING_CARRIERS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"] as const;

/** Print and exit non-zero. Argument errors are the operator's to fix, loudly. */
function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

// ─── Local dev channels (-D) ────────────────────────────────────────────────

type McpServerDef = { command: string; args: string[] };

/**
 * Registry of local dev channels reachable via `-D <name>`, read from the data
 * tree (paths.devChannelsFile). Shape:
 *
 *   { "gather": { "command": "bun", "args": ["/abs/path/to/channel.ts"] } }
 *
 * Paths MUST be absolute. A channel is spawned with whatever cwd the session
 * happens to have, and the whole point is talking to ndeko through the channel
 * while working in some OTHER project — a channel repo's own .mcp.json is
 * typically relative and so only resolves when cwd is that repo.
 *
 * Missing file is not an error here; it becomes one only if -D is actually used,
 * so the common launch path never pays for a feature it isn't using.
 */
function loadDevChannelRegistry(): Record<string, McpServerDef> {
  const target = devChannelsFile();
  if (!existsSync(target)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch (e) {
    fail(`-D: ${target} is not valid JSON — ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`-D: ${target} must be a JSON object of name → { command, args }`);
  }

  const out: Record<string, McpServerDef> = {};
  for (const [name, def] of Object.entries(parsed as Record<string, unknown>)) {
    const d = def as Partial<McpServerDef>;
    if (typeof d?.command !== "string" || !Array.isArray(d?.args)) {
      fail(`-D: ${target} entry '${name}' must have a string 'command' and an array 'args'`);
    }
    out[name] = { command: d.command, args: d.args as string[] };
  }
  return out;
}

/**
 * Merge dev-channel servers into <cwd>/.mcp.json and leave them there.
 *
 * WHY A FILE RATHER THAN --mcp-config: that flag CANNOT register a channel.
 * Claude's channel validator builds its known-server set from config-file
 * scopes only (enterprise, user, project, local) and --mcp-config is not a
 * scope. A server passed that way connects and shows up in /mcp, yet the
 * channel check still reports "no MCP server configured with that name".
 * project scope reads .mcp.json from cwd upward, so this is the only mechanism
 * that makes a `server:` channel resolvable. (Verified on a real pty; `-p`
 * skips the dev branch entirely and cannot see any of this.)
 *
 * The entry PERSISTS by design. Every session launched from this directory will
 * spawn the channel, and a channel dials its bridge as soon as it is spawned —
 * two sessions from the same directory means the newest one steals the
 * attachment. The directory is the scope; running one at a time is the
 * operator's job. Delete the entry (or the file) to stop it.
 *
 * Existing servers are preserved; only the named keys are added or updated, and
 * a no-op merge skips the write so repeat launches don't churn the file's mtime
 * or dirty a tracked repo.
 */
function writeDevChannelConfig(configs: Record<string, McpServerDef>): void {
  const target = join(process.cwd(), ".mcp.json");
  const existing = existsSync(target) ? readFileSync(target, "utf8") : null;

  let parsed: { mcpServers?: Record<string, unknown> };
  try {
    parsed = existing ? JSON.parse(existing) : {};
  } catch {
    fail(`-D: ${target} exists but is not valid JSON — refusing to overwrite it`);
  }

  const servers = { ...(parsed.mcpServers ?? {}) };
  const added: string[] = [];
  for (const [name, def] of Object.entries(configs)) {
    if (JSON.stringify(servers[name]) === JSON.stringify(def)) continue;
    servers[name] = def;
    added.push(name);
  }
  if (added.length === 0) return;

  parsed.mcpServers = servers;
  writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`);
  console.log(`  · wrote ${added.join(", ")} to ${target} — it stays until you remove it`);
}

/**
 * Resolve `-D` names against the registry and return the tagged entries for
 * --dangerously-load-development-channels.
 *
 * TAGGED, NOT BARE: both --channels and the dev flag share one validator, and
 * it rejects bare names.
 *
 * Deliberately does NOT also emit --channels. The two flags produce two
 * INDEPENDENT entries rather than one merged entry, each carrying the dev bit of
 * the list it came from — so a --channels entry arrives dev=false and fails
 * "server: entries need --dangerously-load-development-channels", while the
 * channel gets registered twice. The dev flag alone both selects and authorizes.
 */
function resolveDevChannels(names: string[]): { tagged: string[]; configs: Record<string, McpServerDef> } {
  const registry = loadDevChannelRegistry();
  const known = Object.keys(registry);
  const configs: Record<string, McpServerDef> = {};
  const tagged: string[] = [];

  for (const raw of names) {
    // Tolerate an explicit prefix so `-D gather` and `-D server:gather` agree.
    const name = raw.replace(/^server:/, "");
    if (name.includes(":")) {
      fail(
        `-D takes a bare MCP server name, got '${raw}'.\n` +
          "For a plugin channel, pass claude's own flag through: --channels plugin:<name>@<marketplace>",
      );
    }
    const def = registry[name];
    if (!def) {
      fail(
        `-D: unknown dev channel '${name}'.\n` +
          `registry: ${devChannelsFile()}${existsSync(devChannelsFile()) ? "" : " (missing)"}\n` +
          `known:    ${known.length ? known.join(", ") : "(none configured)"}\n` +
          "For a server configured elsewhere, pass claude's flags through:\n" +
          `  --channels server:${name} --dangerously-load-development-channels server:${name}`,
      );
    }
    // A moved or renamed channel file would otherwise surface as an opaque
    // spawn error well after launch.
    if (!existsSync(def.args[0] ?? "")) {
      fail(`-D: channel '${name}' points at a missing file: ${def.args[0]}`);
    }
    configs[name] = def;
    tagged.push(`server:${name}`);
  }
  return { tagged: [...new Set(tagged)], configs };
}

/**
 * Resolve the claude binary. Bun.which first, then the standard install
 * location, then the bare name. The explicit fallback matters when spawned
 * from launchd or a hook, where PATH is minimal.
 */
function resolveClaudeBin(): string {
  const found = Bun.which("claude");
  if (found) return found;
  const standard = join(homedir(), ".local", "bin", "claude");
  if (existsSync(standard)) return standard;
  return "claude";
}

interface Options {
  mode: "config-dir" | "flags";
  dryRun: boolean;
  /** Bare registry names given to -D, in order, pre-resolution. */
  devChannels: string[];
  passthrough: string[];
}

/**
 * Collect values for a variadic flag, mirroring claude's own `<entries...>`
 * options: consume following tokens until the next flag, and additionally split
 * the comma-separated form. Returns the values plus the last index consumed.
 */
function collectVariadic(argv: string[], start: number): { values: string[]; end: number } {
  const values: string[] = [];
  let i = start;
  // Bind the lookahead before testing it: under noUncheckedIndexedAccess an
  // indexed read is `string | undefined`, and a bounds check on the line above
  // is not narrowing the compiler can follow.
  for (;;) {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("-")) break;
    i++;
    values.push(
      ...next
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return { values, end: i };
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { mode: "config-dir", dryRun: false, devChannels: [], passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--flags") opts.mode = "flags";
    else if (a === "--config-dir") opts.mode = "config-dir";
    else if (a === "--dry-run" || a === "-n") opts.dryRun = true;
    else if (a === "-D" || a === "--dev-channel" || a === "--dev-channels") {
      const { values, end } = collectVariadic(argv, i);
      i = end;
      if (values.length === 0) fail("-D needs at least one dev channel name (e.g. -D gather)");
      opts.devChannels.push(...values);
    } else if (a === "--bare") {
      fail(
        "refusing --bare: it forces ANTHROPIC_API_KEY auth and breaks the subscription-only constraint.\n" +
          "use --safe-mode for a customization-free session instead.",
      );
    } else opts.passthrough.push(a);
  }
  return opts;
}

function buildArgs(opts: Options, devTagged: string[]): string[] {
  const args: string[] = [];

  // No --append-system-prompt-file: system-prompt.md is the `ndeko` output style
  // (output-styles/ndeko.md links to it; settings.json selects it), so every
  // session loads it by convention. The flag route could not reach sessions that
  // `claude remote-control` starts — it refuses to launch rather than drop the
  // flag (verified 2.1.283, 2026-09-26) — and keeping both would load it twice.

  if (opts.mode === "flags") {
    // `--setting-sources ''` isolates the session from user/project/local
    // settings so only ours apply.
    args.push("--setting-sources", "");
    if (existsSync(settingsFile())) args.push("--settings", settingsFile());
    args.push("--add-dir", harnessRoot());
  }

  // Local channel development only — bypasses the channel allowlist. See
  // resolveDevChannels for why --channels is deliberately NOT also emitted.
  if (devTagged.length) args.push("--dangerously-load-development-channels", ...devTagged);

  args.push(...opts.passthrough);
  return args;
}

/** The style file Claude Code reads; a symlink to system-prompt.md. */
const outputStyleFile = () => join(harnessRoot(), "output-styles", "ndeko.md");

/** Whether the harness settings select the ndeko style. Unparseable reads as no. */
function outputStyleSelected(): boolean {
  try {
    return JSON.parse(readFileSync(settingsFile(), "utf8")).outputStyle === "ndeko";
  } catch {
    return false;
  }
}

/** Report anything that would make this session weaker than the real install. */
function preflight(): string[] {
  const notes: string[] = [];
  const roots = describeRoots();

  if (!roots.dataExists) notes.push(`data root missing: ${roots.dataRoot} — identity and memory will be empty`);
  if (!existsSync(systemPromptFile())) notes.push("system-prompt.md not written — session runs without ndeko doctrine");
  if (!existsSync(outputStyleFile())) notes.push("output-styles/ndeko.md missing — session runs without ndeko doctrine");
  else if (!outputStyleSelected()) notes.push('settings.json does not set "outputStyle": "ndeko" — session runs without ndeko doctrine');
  if (!existsSync(settingsFile())) notes.push("settings.json not written — harness defaults apply");
  if (!algorithmFile()) notes.push("algorithm doctrine unresolved — algorithm/LATEST missing or points at a missing file");

  const skills = existsSync(skillsDir()) ? readdirSync(skillsDir()).filter((d) => !d.startsWith(".")) : [];
  if (skills.length === 0) notes.push("skills/ is empty — curation gate not yet applied");

  const present = BILLING_CARRIERS.filter((k) => process.env[k]);
  if (present.length) notes.push(`stripping billing carriers from the child env: ${present.join(", ")}`);

  return notes;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const roots = describeRoots();
  const dev = opts.devChannels.length
    ? resolveDevChannels(opts.devChannels)
    : { tagged: [], configs: {} as Record<string, McpServerDef> };
  const args = buildArgs(opts, dev.tagged);
  const bin = resolveClaudeBin();

  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of BILLING_CARRIERS) delete env[k];
  env.NDEKO_DATA_DIR = roots.dataRoot;
  if (opts.mode === "config-dir") env.CLAUDE_CONFIG_DIR = roots.harnessRoot;
  else delete env.CLAUDE_CONFIG_DIR;

  console.log(`ndeko  ${roots.harnessRoot}  [${opts.mode}]`);
  console.log(`data   ${roots.dataRoot}`);
  for (const n of preflight()) console.log(`  · ${n}`);

  if (opts.dryRun) {
    console.log(`\n${bin} ${args.map((a) => (a === "" ? "''" : a)).join(" ")}`);
    console.log(`\nCLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR ?? "(unset)"}`);
    console.log(`NDEKO_DATA_DIR=${env.NDEKO_DATA_DIR}`);
    for (const name of Object.keys(dev.configs)) {
      console.log(`would merge mcpServers.${name} into ${join(process.cwd(), ".mcp.json")}`);
    }
    return;
  }

  // ndeko never chdirs, so cwd here is the cwd claude launches in — which is the
  // scope .mcp.json has to land in for the channel to resolve.
  if (Object.keys(dev.configs).length) writeDevChannelConfig(dev.configs);

  const proc = Bun.spawn([bin, ...args], {
    stdio: ["inherit", "inherit", "inherit"],
    env: env as Record<string, string>,
  });
  await proc.exited;
  process.exit(proc.exitCode ?? 0);
}

if (import.meta.main) await main();
