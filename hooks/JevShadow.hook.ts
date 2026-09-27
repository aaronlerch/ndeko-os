#!/usr/bin/env bun
/**
 * @version 1.0.0
 * JevShadow.hook.ts — log-only Jev experiments on every turn (Stop).
 *
 * WHY THIS EXISTS
 *
 * Jev (TypeSafe AI) answers typed yes/no, pick-one, and scale questions in
 * ~200ms with calibrated probabilities. Two places in this harness make that
 * kind of judgment with regexes or not at all: whether a final message claims
 * something (VerificationGate), and which skill a prompt wants. This hook asks
 * Jev the same questions in SHADOW and logs its answers beside the ground truth
 * the transcript already holds, so "would Jev do better?" gets answered by a
 * corpus instead of instinct.
 *
 * WHAT IT DOES NOT DO
 *
 * It never blocks, injects context, or changes anything the session sees. The
 * Stop handler writes the payload to a queue file, spawns a detached worker, and
 * exits — so the network call adds zero latency to the turn. The worker's answers
 * go to the data tree's `state/jev-shadow.jsonl` and nowhere else.
 *
 * OPTIONAL BY CONSTRUCTION
 *
 * Off unless the data tree's config.toml has `[typesafe] shadow = true` AND the
 * env var it names (`api_key_env`, default TYPESAFE_API_KEY) holds a key. Either
 * missing, and the hook exits before touching the transcript. Setting that flag
 * is the principal's consent to the egress below (system-prompt.md § Privacy
 * boundary, third-party services); this file never records whose install it is.
 * JEVSHADOW_OFF=1 disables it for one shell. Fail-open everywhere.
 *
 * Egress: the turn's prompt, its final message, and skill descriptions go to
 * api.typesafe.ai. The destination is fixed here, never taken from content. This
 * is an egress path Taint.hook.ts cannot see (§ KNOWN EXCEPTION there).
 *
 * TRIGGER: Stop
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readHookInput } from "./lib/hook-io.ts";
import { dataPath, stateDir } from "./lib/paths.ts";
import { loadJevConfig } from "./lib/typesafe.ts";
import { loadSkillRoster, parseTurns, shadowTurn } from "./lib/jev-shadow.ts";

export const LOG_PATH = () => dataPath("state", "jev-shadow.jsonl");
const QUEUE_DIR = () => join(stateDir(), "jev-queue");

interface Payload {
  session_id: string;
  transcript_path: string;
  cwd?: string;
  last_assistant_message?: string;
}

/** The worker: one turn, all experiments, one log line. Exported for tests. */
export async function work(p: Payload): Promise<Record<string, unknown> | null> {
  const cfg = loadJevConfig();
  if (!cfg) return null;
  let raw = "";
  try { raw = readFileSync(p.transcript_path, "utf8"); } catch { return null; }
  const turn = parseTurns(raw).at(-1);
  if (!turn) return null;
  // The Stop payload's message is authoritative; the transcript may not have flushed it yet.
  if (p.last_assistant_message) turn.finalMessage = p.last_assistant_message;
  const rec = await shadowTurn(cfg, turn, { roster: loadSkillRoster(p.cwd) });
  const line = { ts: new Date().toISOString(), source: "live", model: cfg.model, session: p.session_id, cwd: p.cwd, turn: turn.index, ...rec };
  try {
    mkdirSync(stateDir(), { recursive: true });
    appendFileSync(LOG_PATH(), JSON.stringify(line) + "\n");
  } catch { /* fail open */ }
  return line;
}

async function dispatch(): Promise<void> {
  if (process.env.JEVSHADOW_OFF === "1") return;
  const input = await readHookInput();
  if (!input || input.stop_hook_active === true) return;
  if (!loadJevConfig()) return;
  const payload: Payload = {
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    cwd: input.cwd,
    last_assistant_message: input.last_assistant_message,
  };
  mkdirSync(QUEUE_DIR(), { recursive: true });
  const file = join(QUEUE_DIR(), `${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(payload));
  const child = spawn(process.execPath, [import.meta.path, "--worker", file], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

if (import.meta.main) {
  const i = process.argv.indexOf("--worker");
  if (i !== -1) {
    const file = process.argv[i + 1]!;
    (async () => {
      try {
        if (existsSync(file)) await work(JSON.parse(readFileSync(file, "utf8")) as Payload);
      } finally {
        rmSync(file, { force: true });
      }
    })().catch(() => {}).finally(() => process.exit(0));
  } else {
    dispatch().catch(() => {}).finally(() => process.exit(0));
  }
}
