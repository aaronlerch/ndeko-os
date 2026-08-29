/**
 * hook-io.ts — read and validate hook stdin.
 *
 * Deliberately minimal. Upstream's equivalent was 89 lines that transitively
 * pulled TranscriptParser + identity + LifeosConfig (~1,050 lines) and the
 * `yaml` npm package — the only real dependency in the whole set — because it
 * also exported a transcript parser. We took the stdin reader and left the
 * parser behind.
 *
 * Zero runtime dependencies is a requirement, not an aesthetic: a hook must be
 * importable before `bun install` has ever run in this tree, because a hook
 * that fails to load is a gate that silently does not fire.
 */

import { type BaseHookInput, parseHookStdin, validateBaseHookInput } from "./hook-input.ts";

/** How long to wait for the harness to finish writing stdin. */
const STDIN_TIMEOUT_MS = 2000;

/**
 * Hook stdin. The three fields from BaseHookInput (session_id,
 * transcript_path, hook_event_name) are guaranteed present — the validator
 * rejects the payload otherwise. Everything below is event-dependent and
 * therefore optional.
 */
export interface HookInput extends BaseHookInput {
  /** Set on Stop / SubagentStop when a prior block already fired this turn. */
  stop_hook_active?: boolean;
  /**
   * Present on Stop. The text of the turn's final assistant message — the
   * source of *claims*. Evidence, by contrast, comes only from the transcript's
   * actual tool calls, which is what makes rewording a claim unable to pass the
   * verification gate.
   */
  last_assistant_message?: string;
  /** Present on tool events. */
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  cwd?: string;
}

/**
 * Read hook input from stdin.
 * Returns null on timeout, unparseable JSON, or a shape that fails validation —
 * callers treat null as "do nothing and exit 0". Failing open is correct here:
 * a malformed payload is a harness or version problem, and taking down the
 * session over it would be worse than skipping one gate invocation.
 */
export async function readHookInput(): Promise<HookInput | null> {
  let raw: string;
  try {
    raw = await Promise.race([
      new Response(Bun.stdin.stream()).text(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("stdin timeout")), STDIN_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return null;
  }

  const parsed = parseHookStdin(raw);
  if (!parsed.ok) return null;

  // Validate the three guaranteed fields rather than casting past them — the
  // whole point of the type guards is that a malformed payload is caught here
  // and not three frames deeper as an undefined property access.
  const base = validateBaseHookInput(parsed.value);
  if (!base.ok) return null;

  return { ...parsed.value, ...base.value } as HookInput;
}

/** Emit an advisory line to the user and exit successfully. Never blocks. */
export function advise(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(0);
}

/**
 * Block the pending action. Exit code 2 is the harness's universal block
 * signal and cannot be overridden by JSON claiming otherwise — deterministic
 * wins over model judgment, by design.
 */
export function block(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

/** Inject context for the model to read on the next turn. */
export function injectContext(event: string, context: string): never {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }),
  );
  process.exit(0);
}
