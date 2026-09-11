/**
 * Saved browser sessions, so a demo can walk a site you have to be logged into.
 *
 * A session is Playwright's own `storageState` — cookies plus localStorage —
 * captured once by the login command from a browser a human signed into by
 * hand, and replayed into every later take's context.
 *
 * **Why a human does the signing in.** Typing a credential into the walk was
 * the obvious alternative and it fails exactly where it would be needed: an SSO
 * redirect, an MFA step, a device prompt, a bot check. Handing the browser to
 * the person for fifteen seconds handles all of them, and the credential never
 * leaves the password manager it lives in. See scripts/demo-video/README.md.
 *
 * A session file is a bearer token in a file. It is written 0600, it lives in
 * the machine-local config dir, and it must never be inside the checkout —
 * `sessionPath` is the only thing that decides where it goes, so there is no
 * path for a storyboard to point one somewhere committable.
 */
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContextOptions } from "playwright";
import { PRODUCT } from "../product";
import { configDir } from "./config-dir";

/**
 * Playwright's own type for what `newContext({ storageState })` accepts, so a
 * loaded session flows into the recorder with no cast.
 */
type StorageState = Exclude<
  BrowserContextOptions["storageState"],
  string | undefined
>;

export function sessionsDir(): string {
  return join(configDir(), "sessions");
}

export function sessionPath(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `session name "${name}" is not usable — lowercase kebab-case only (it names a file, and must not be able to escape the sessions dir)`,
    );
  }
  return join(sessionsDir(), `${name}.json`);
}

export async function listSessions(): Promise<string[]> {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

export async function saveSession(
  name: string,
  state: StorageState,
): Promise<string> {
  const path = sessionPath(name);
  await mkdir(sessionsDir(), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
  // Before anyone else on a shared machine can read it.
  await chmod(path, 0o600);
  return path;
}

export interface SessionSummary {
  /** Domains this session carries cookies for, deduped. */
  domains: string[];
  /** Origins with saved localStorage. */
  origins: string[];
  /**
   * Earliest expiry across cookies that have one, as epoch seconds, or null
   * when every cookie is a session cookie with no stated expiry.
   */
  expiresAt: number | null;
}

export function summarize(state: StorageState): SessionSummary {
  const cookies = state.cookies ?? [];
  const dated = cookies
    .map((c) => c.expires)
    .filter((e): e is number => typeof e === "number" && e > 0);
  return {
    domains: [...new Set(cookies.map((c) => c.domain))].sort(),
    origins: (state.origins ?? []).map((o) => o.origin).sort(),
    expiresAt: dated.length ? Math.min(...dated) : null,
  };
}

/**
 * Load a session for a recording, or throw with the command that fixes it.
 *
 * An expired session is a hard error rather than a warning on purpose. Replayed
 * dead cookies do not fail as "not logged in" — the walk lands on a sign-in
 * page and dies thirty seconds later on a selector that looks wrong, which is
 * the most expensive way to learn that a cookie lapsed.
 */
export async function loadSession(
  name: string,
): Promise<{ state: StorageState; summary: SessionSummary; path: string }> {
  const path = sessionPath(name);
  if (!existsSync(path)) {
    throw new Error(
      `this take needs the saved session "${name}", which does not exist.
  Create it:  ${PRODUCT.cmd.login} ${name} --url <the site's sign-in page>
  Existing:   ${(await listSessions()).join(", ") || "(none)"}`,
    );
  }
  let state: StorageState;
  try {
    state = JSON.parse(await readFile(path, "utf8")) as StorageState;
  } catch (e) {
    throw new Error(`${path} is not valid JSON — ${(e as Error).message}`);
  }
  const summary = summarize(state);
  const now = Date.now() / 1000;
  if (summary.expiresAt !== null && summary.expiresAt < now) {
    throw new Error(
      `the saved session "${name}" expired ${new Date(
        summary.expiresAt * 1000,
      ).toISOString()}.
  Sign in again:  ${PRODUCT.cmd.login} ${name} --url <the site's sign-in page>`,
    );
  }
  return { state, summary, path };
}

/** Human-readable expiry, for the runner's log. */
export function describeExpiry(summary: SessionSummary): string {
  if (summary.expiresAt === null) return "session cookies only";
  const days = (summary.expiresAt - Date.now() / 1000) / 86400;
  return days < 1
    ? `earliest cookie expires in ${Math.max(0, Math.round(days * 24))}h`
    : `earliest cookie expires in ${Math.round(days)}d`;
}
