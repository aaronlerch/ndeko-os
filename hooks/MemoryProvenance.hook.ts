#!/usr/bin/env bun
/**
 * MemoryProvenance.hook.ts — PostToolUse on Write | Edit | MultiEdit
 *
 * WHY THIS EXISTS
 *
 * Persistent memory is the highest-value target this system owns. MINJA reports
 * >95% memory-injection success through *normal queries only* — no privileged
 * access — and the payload persists after the attacker is gone, firing in later
 * sessions. Three of six independent research sweeps flagged this as the top
 * unaddressed hole. Separately, "misevolution" work documents safety alignment
 * degrading through pure memory accumulation with no attacker at all.
 *
 * Native harness memory has an index and a consolidation pass, which is why we
 * do not rebuild those. What it does not have is provenance: a record of where
 * a claim came from. A learning distilled from a verified run and a learning
 * distilled from a fetched web page are not the same trust tier, and without a
 * field distinguishing them, consolidation will happily merge the two.
 *
 * So this hook stamps four keys on every memory file written:
 *
 *   valid_from     when this became true
 *   valid_until    when it stopped (null while current)
 *   superseded_by  what replaced it — the retirement path
 *   source         trust tier: user | tool-output | web | subagent
 *
 * The bi-temporal pair is the cheap 80% of a knowledge graph: it gives
 * contradiction detection and a mechanical way to retire a fact, which the
 * predecessor's rules file lacked entirely — it could only grow.
 *
 * SCOPE AND HONESTY
 *
 * This runs PostToolUse, so it stamps after the write rather than gating it.
 * That is the correct trade: a gate here would block the harness's own memory
 * writes, and the harness owns that path. Stamping is additive and cannot break
 * a write. `source` is inferred from session taint state, which means it is a
 * best-effort classification, not proof — an unverified `source: web` is still
 * more information than no field at all.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readHookInput } from "./lib/hook-io.ts";
import { memoryDir, stateDir } from "./lib/paths.ts";

type TrustTier = "user" | "tool-output" | "web" | "subagent";

/** Only markdown inside the memory tree gets stamped. */
function isMemoryFile(filePath: string): boolean {
  if (!filePath.endsWith(".md")) return false;
  const dir = memoryDir();
  return filePath === dir || filePath.startsWith(`${dir}/`);
}

/**
 * Infer the trust tier. If the session ingested untrusted content before this
 * write, anything distilled during it may carry that influence — so it is
 * classified by the weakest input the session saw, not the strongest.
 */
function inferSource(sessionId: string): TrustTier {
  const p = join(stateDir(), `taint-${sessionId.replace(/[^\w.-]/g, "_")}.json`);
  if (!existsSync(p)) return "user";
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
    const s = parsed as { tainted?: unknown; sources?: unknown };
    if (s.tainted !== true) return "user";
    const sources = Array.isArray(s.sources) ? s.sources.map(String) : [];
    if (sources.some((x) => /^(WebFetch|WebSearch)/.test(x))) return "web";
    if (sources.some((x) => x.startsWith("mcp__"))) return "tool-output";
    return "tool-output";
  } catch {
    return "user";
  }
}

const KEYS = ["valid_from", "valid_until", "superseded_by", "source"] as const;

/** Add only the provenance keys that are missing. Never overwrite an existing value. */
function stamp(content: string, source: TrustTier): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const desired: Record<string, string> = {
    valid_from: today,
    valid_until: "null",
    superseded_by: "null",
    source,
  };

  const fm = content.startsWith("---\n") ? content.indexOf("\n---", 4) : -1;

  if (fm === -1) {
    // No frontmatter at all — prepend a block.
    const block = KEYS.map((k) => `${k}: ${desired[k]}`).join("\n");
    return `---\n${block}\n---\n\n${content}`;
  }

  const head = content.slice(4, fm);
  const rest = content.slice(fm + 1); // keeps the closing ---
  const missing = KEYS.filter((k) => !new RegExp(`^${k}\\s*:`, "m").test(head));
  if (missing.length === 0) return null; // already stamped; nothing to do

  const added = missing.map((k) => `${k}: ${desired[k]}`).join("\n");
  return `---\n${head.replace(/\n*$/, "\n")}${added}\n${rest}`;
}

async function main(): Promise<void> {
  const input = await readHookInput();
  if (!input) process.exit(0);

  const filePath = typeof input.tool_input?.file_path === "string" ? input.tool_input.file_path : "";
  if (!filePath || !isMemoryFile(filePath) || !existsSync(filePath)) process.exit(0);

  // MEMORY.md is the harness's own index, not a memory record. Leave it alone.
  if (filePath.endsWith("/MEMORY.md")) process.exit(0);

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    process.exit(0);
  }

  const source = inferSource(input.session_id);
  const stamped = stamp(content, source);
  if (stamped === null) process.exit(0);

  try {
    writeFileSync(filePath, stamped, "utf8");
  } catch {
    process.exit(0); // fail open
  }

  if (source !== "user") {
    process.stderr.write(
      `memory: stamped ${filePath.split("/").pop()} with source: ${source} — ` +
        `this session ingested untrusted content, so treat that entry as lower trust.\n`,
    );
  }
  process.exit(0);
}

if (import.meta.main) {
  main().catch(() => process.exit(0)); // fail open
}
