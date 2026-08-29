#!/usr/bin/env bun
/**
 * BillingGuard.hook.ts — SessionStart
 *
 * Asserts the session is running on the OAuth subscription rather than a
 * metered API key. A `claude --bare` invocation, or a stray ANTHROPIC_API_KEY
 * in the environment, silently switches the billing carrier. That exact
 * mistake cost a four-figure API bill in a single month, and it is invisible
 * until the invoice arrives.
 *
 * WHAT THIS HOOK CAN AND CANNOT DO — stated plainly, because the limit matters:
 *
 * SessionStart does NOT block on exit 2. Its stderr goes to the user only. So
 * this hook cannot prevent a mis-billed session; it can only make the problem
 * loud at the top of one, and inject context so the model knows not to spawn
 * subprocesses that would inherit the carrier.
 *
 * The actual enforcement lives in two other places, and this hook is the third
 * layer rather than the only one:
 *   - `permissions.deny` blocks `claude --bare` as a command outright
 *   - `tools/ndeko.ts` strips all three carrier vars before spawn
 *
 * Out-of-band verification of a real session's billing path is a separate
 * tool: `tools/BillingPathAssertion.ts`, which parses stream-json output. It
 * cannot run from inside a hook, because CLAUDECODE blocks nested sessions.
 */

import { readHookInput } from "./lib/hook-io.ts";

/** Env vars that move inference off the OAuth subscription. */
const CARRIERS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"] as const;

/** Redact a carrier value to a shape that identifies it without leaking it. */
function fingerprint(value: string): string {
  if (value.length <= 8) return `${value.length} chars`;
  return `${value.slice(0, 6)}…${value.slice(-2)} (${value.length} chars)`;
}

async function main(): Promise<void> {
  // Read stdin so the harness is not left with an unconsumed pipe, but this
  // hook's decision depends only on the ambient environment.
  await readHookInput();

  const present = CARRIERS.filter((k) => {
    const v = process.env[k];
    return typeof v === "string" && v.trim() !== "";
  });

  if (present.length === 0) {
    process.exit(0);
  }

  const detail = present.map((k) => `  ${k} = ${fingerprint(process.env[k] ?? "")}`).join("\n");

  process.stderr.write(
    [
      "",
      "⚠️  BILLING CARRIER PRESENT IN THIS ENVIRONMENT",
      "",
      detail,
      "",
      "  This session may be billing to a metered API key instead of the OAuth",
      "  subscription. Any `claude` subprocess spawned from here inherits it.",
      "",
      "  Check with:  claude /status",
      "  Unset with:  unset " + present.join(" "),
      "",
    ].join("\n"),
  );

  // Tell the model too, so it does not spawn subprocesses that inherit the
  // carrier without knowing the environment is dirty.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          `Billing carrier env vars are set in this session: ${present.join(", ")}. ` +
          "Inference may be on metered API billing rather than the OAuth subscription. " +
          "Do not spawn any `claude` subprocess without stripping these three vars first, " +
          "and surface this to Aaron before running anything expensive.",
      },
    }),
  );
  process.exit(0);
}

if (import.meta.main) {
  main().catch(() => process.exit(0)); // fail open: never take down a session
}
