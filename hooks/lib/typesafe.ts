/**
 * typesafe.ts — minimal client for TypeSafe's Jev model (api.typesafe.ai).
 *
 * Jev answers typed questions about a `state` (Noul = P(yes), Choice = pick one,
 * Score = position on ordered levels) with calibrated probabilities. It does not
 * generate text. Everything here is SHADOW-ONLY: answers are logged as data and
 * never steer a session. See the recommendation in the data tree
 * (`work/jev/recommendation.md`) and Taint.hook.ts § KNOWN EXCEPTION.
 *
 * Plain fetch, zero dependencies (hooks must load before `bun install`).
 * Configuration lives in the data tree's config.toml under [typesafe]; the key
 * lives in the environment variable that section names, never in this repo.
 * Every failure returns null — a shadow must never be why anything breaks.
 */

import { existsSync, readFileSync } from "node:fs";
import { configFile } from "./paths.ts";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export interface JevConfig {
  apiKey: string;
  model: string;
  shadow: boolean;
  timeoutMs: number;
}

/** Null when the section is absent, shadow is off, or the key is not in the env. */
export function loadJevConfig(env: NodeJS.ProcessEnv = process.env): JevConfig | null {
  try {
    const path = configFile();
    if (!existsSync(path)) return null;
    const cfg = Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const ts = cfg.typesafe as Record<string, unknown> | undefined;
    if (!ts || ts.shadow !== true) return null;
    const keyEnv = typeof ts.api_key_env === "string" ? ts.api_key_env : "TYPESAFE_API_KEY";
    const apiKey = env[keyEnv];
    if (!apiKey) return null;
    return {
      apiKey,
      // Pinned, never an alias: thresholds tuned on one build do not carry to the next.
      model: typeof ts.model === "string" ? ts.model : "jev-1.13.0",
      shadow: true,
      timeoutMs: typeof ts.timeout_ms === "number" ? ts.timeout_ms : 8000,
    };
  } catch {
    return null;
  }
}

export type Question =
  | { type: "noul"; instructions: unknown; criteria?: { true?: unknown; false?: unknown } }
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: unknown[] };

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number; legend: Record<string, string> };

export interface JevResult {
  answers: Record<string, Answer>;
  model: string;
  inputTokens: number;
  ms: number;
}

export interface JevError { error: string; ms: number }

/** One request. Returns the answers, or an error record (never throws). */
export async function askJev(
  cfg: JevConfig,
  state: unknown,
  questions: Record<string, Question>,
): Promise<JevResult | JevError> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  try {
    let res: Response | null = null;
    // 429 / 529 are the vendor's documented retry-with-backoff statuses.
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state, model: cfg.model, questions }),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      if (res.status !== 429 && res.status !== 529) break;
      const after = Number(res.headers.get("retry-after"));
      await Bun.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt);
    }
    if (!res) return { error: "no response", ms: ms() };
    if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, ms: ms() };
    const body = (await res.json()) as { model?: string; answers?: Record<string, Answer>; usage?: { input_tokens?: number } };
    if (!body.answers) return { error: "response had no answers", ms: ms() };
    return { answers: body.answers, model: body.model ?? cfg.model, inputTokens: body.usage?.input_tokens ?? 0, ms: ms() };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e).slice(0, 300), ms: ms() };
  }
}

export function isJevError(r: JevResult | JevError): r is JevError {
  return "error" in r;
}

/** Noul value by key, or null. */
export function noul(r: JevResult | JevError, key: string): number | null {
  if (isJevError(r)) return null;
  const a = r.answers[key];
  return a?.type === "noul" ? Math.round(a.noul * 1000) / 1000 : null;
}
