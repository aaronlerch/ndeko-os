#!/usr/bin/env bun
/**
 * MemoryReconcile.hook.ts — PostToolUse on Write | Edit | MultiEdit
 *
 * WHY THIS EXISTS
 *
 * `MemoryProvenance` stamps four keys on every memory file, one of which is
 * `superseded_by`. For its entire life nothing ever set it. The retirement
 * FIELD existed; the retirement PROCEDURE did not, so memory could only grow —
 * which is the exact failure the bi-temporal keys were added to prevent.
 *
 * This is the missing half. Mem0's update phase is the reference design: on a
 * write, retrieve the nearest existing memories and force an explicit
 * ADD / UPDATE / SUPERSEDE / NOOP verdict naming *which* memory is affected.
 *
 * WHAT A HOOK CAN AND CANNOT DO HERE
 *
 * It cannot render the verdict. "Is this the same fact?" is judgment, and a
 * hook has no model. Building one that guessed would be a silent-failure
 * machine sitting on the highest-value data this system owns.
 *
 * So the split is: the hook detects the *condition* deterministically — a new
 * memory that overlaps an existing one past a threshold — and puts the
 * candidates plus the four verdicts into the next turn's context. The model
 * decides. `tools/memory.ts supersede` then performs the mechanical half so the
 * decision cannot be recorded half-way.
 *
 * That keeps it inside the hook charter: a checkable property of an artifact,
 * not a rule about how to work.
 *
 * FAILS OPEN, ALWAYS
 *
 * A duplicate memory is a nuisance. A hook that takes down a memory write is a
 * data-loss event. Every failure path here exits 0.
 */

import { existsSync } from "node:fs";
import { injectContext } from "./lib/hook-io.ts";
import { readHookInput } from "./lib/hook-io.ts";
import { findCandidates, listMemories, parseMemory } from "./lib/memory-records.ts";
import { memoryDir } from "./lib/paths.ts";

/** Only markdown directly inside the memory tree is a memory record. */
function isMemoryFile(filePath: string): boolean {
  if (!filePath.endsWith(".md")) return false;
  if (filePath.endsWith("/MEMORY.md")) return false;
  const dir = memoryDir();
  return filePath.startsWith(`${dir}/`);
}

const MAX_REPORTED = 3;

async function main(): Promise<void> {
  const input = await readHookInput();
  if (!input) process.exit(0);

  const filePath = typeof input.tool_input?.file_path === "string" ? input.tool_input.file_path : "";
  if (!filePath || !isMemoryFile(filePath) || !existsSync(filePath)) process.exit(0);

  const subject = parseMemory(filePath);
  if (!subject) process.exit(0);

  // A record being retired is not a record being written. Editing `valid_until`
  // onto a file must not re-trigger reconciliation against its own replacement.
  if (subject.retired) process.exit(0);

  const candidates = findCandidates(subject, listMemories(memoryDir())).slice(0, MAX_REPORTED);
  if (candidates.length === 0) process.exit(0);

  const lines = candidates.map(
    (c) =>
      `  - \`${c.record.slug}\` (overlap ${c.score.toFixed(2)}) — ${c.record.description || "(no description)"}`,
  );

  injectContext(
    "PostToolUse",
    [
      `Memory reconciliation required for \`${subject.slug}\`.`,
      "",
      "It overlaps existing memories that are still marked current:",
      ...lines,
      "",
      "Resolve with exactly one verdict before this turn closes:",
      "",
      "  - **ADD** — genuinely distinct. Say why in one line and continue.",
      `  - **UPDATE** — the same fact, better stated. Fold the new content into the existing file and delete \`${subject.slug}.md\`.`,
      "  - **SUPERSEDE** — the new record replaces an old one. Run:",
      `      \`bun tools/memory.ts supersede <old-slug> --by ${subject.slug}\``,
      "    which stamps `valid_until` + `superseded_by` on the old record, moves it to the",
      "    archive (out of the harness's recall index), and rewrites the MEMORY.md line.",
      `  - **NOOP** — the existing record already covers it. Delete \`${subject.slug}.md\`.`,
      "",
      "An overlap score is a prompt to decide, not a verdict. ADD is a legitimate answer;",
      "leaving two current records that state the same fact differently is not.",
    ].join("\n"),
  );
}

if (import.meta.main) {
  main().catch(() => process.exit(0)); // fail open
}
