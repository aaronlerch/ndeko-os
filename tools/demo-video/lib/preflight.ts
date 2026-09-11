/**
 * Everything that must be true before a take is worth recording.
 *
 * Two kinds of failure this prevents. Tooling: ffmpeg or a Chromium build is
 * missing and you find out ninety seconds into a walk. Data: the narration
 * promises something the database does not contain, which is how the first
 * phase-2 operator cut said "including the two new CRM fields" over a page with
 * no CRM values. The words were right; the data was not; the take was wasted.
 */
import { Client } from "pg";
import { PRODUCT } from "../product";
import { installHint } from "./install-hint";
import type { Check, Storyboard } from "./storyboard";

export interface ToolingReport {
  ok: boolean;
  problems: string[];
}

export async function checkTooling(): Promise<ToolingReport> {
  const problems: string[] = [];

  // Both binaries ship in one package on every platform, so a machine missing
  // them is missing them together. Report it once with one install command
  // rather than printing the same line twice.
  const missingFfmpeg: string[] = [];
  for (const bin of ["ffmpeg", "ffprobe"]) {
    if (!(await onPath(bin))) missingFfmpeg.push(bin);
  }
  if (missingFfmpeg.length > 0) {
    problems.push(
      `${missingFfmpeg.join(" and ")} not on PATH — both ship in the ffmpeg package:\n` +
        `     ${installHint("ffmpeg")}`,
    );
  }

  try {
    const { chromium } = await import("playwright");
    const path = chromium.executablePath();
    if (!(await Bun.file(path).exists())) {
      // On Linux the browser binary alone is not enough — a headless Chromium
      // needs a set of shared libraries the distro does not install by default,
      // which is what `install-deps` pulls in. Those go in as root; the browser
      // itself must not, because Playwright caches it under $HOME.
      const cmd =
        process.platform === "linux"
          ? "sudo bunx playwright install-deps chromium && bunx playwright install chromium"
          : "bunx playwright install chromium";
      problems.push(
        `Playwright's Chromium is not installed — run:\n     ${cmd}`,
      );
    }
  } catch (e) {
    problems.push(
      `playwright is not usable (${(e as Error).message}). Run \`bun install\`.`,
    );
  }

  // One script installs everything above, on macOS and every Linux this
  // detects. Naming it means the failure carries its own fix — and an agent
  // reading this can offer to run it rather than transcribing commands.
  if (problems.length > 0) {
    problems.push(
      `All of the above, installed for you:
     ${PRODUCT.cmd.deps}          (add --check to only report)`,
    );
  }

  return { ok: problems.length === 0, problems };
}

async function onPath(bin: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", bin], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(PRODUCT.databaseHint);
  }
  return url;
}

/** Reachability of the app under test. Cheap, and catches the usual mistake. */
export async function checkStack(baseUrl: string): Promise<void> {
  try {
    const res = await fetch(baseUrl, { redirect: "manual" });
    if (res.status >= 500) {
      throw new Error(`${baseUrl} answered ${res.status}`);
    }
  } catch (e) {
    throw new Error(
      `Cannot reach ${baseUrl} — is the dev stack running?\n` +
        `  ${(e as Error).message}`,
    );
  }
}

/**
 * The interceptor engine's own prerequisites, checked before a take rather
 * than discovered 30 seconds into a walk.
 *
 * Deliberately three separate probes: "no CLI", "bridge not answering" and
 * "bridge too old" have three different fixes, and a single "interceptor is not
 * working" would send you looking in the wrong place.
 */
export async function checkInterceptor(): Promise<void> {
  const which = Bun.spawnSync(["which", "interceptor"]);
  if (which.exitCode !== 0) {
    throw new Error(
      `the interceptor engine needs the \`interceptor\` CLI on PATH.
  Install it from the Interceptor checkout, or use the default engine.`,
    );
  }

  const status = Bun.spawnSync(["interceptor", "status", "--json"]);
  if (status.exitCode !== 0) {
    throw new Error(
      `\`interceptor status\` failed — the daemon or the browser extension is not up.
  ${status.stderr.toString().trim() || status.stdout.toString().trim()}`,
    );
  }

  // `capture record status` is the verb this engine depends on. An older
  // bridge answers "not available"/"notImplemented" rather than a state
  // object, and the difference decides whether the fix is a rebuild.
  const probe = Bun.spawnSync([
    "interceptor",
    "macos",
    "capture",
    "record",
    "status",
    "--json",
  ]);
  const out = probe.stdout.toString() + probe.stderr.toString();
  if (
    probe.exitCode !== 0 ||
    /not available|notImplemented|unknown/i.test(out)
  ) {
    throw new Error(
      `this interceptor-bridge has no \`capture record\` verb.
  Rebuild it from the Interceptor checkout:  ./scripts/build-bridge.sh
  then restart it:  open -gj dist/interceptor-bridge.app
  ${out.trim().slice(0, 200)}`,
    );
  }
}

/**
 * Run a take's data assertions. Throws on the first failure with the storyboard's
 * own explanation of why it mattered.
 */
export async function runChecks(
  checks: Check[],
  baseUrl: string,
): Promise<void> {
  if (checks.length === 0) return;
  let client: Client | null = null;
  try {
    for (const check of checks) {
      if ("url" in check) {
        const target = new URL(check.url, baseUrl).toString();
        const body = await (await fetch(target)).text();
        if (!body.includes(check.expectText)) {
          throw new Error(
            `preflight: ${target} does not contain "${check.expectText}"\n` +
              `  why it matters: ${check.because}`,
          );
        }
        console.log(`  ok  ${check.url} contains "${check.expectText}"`);
        continue;
      }

      if (!client) {
        client = new Client({ connectionString: databaseUrl() });
        await client.connect();
      }
      const result = await client
        .query(check.sql, check.params ?? [])
        .catch((e: { code?: string; message: string }) => {
          // A storyboard outlives the schema it was written against. Say so in
          // those words rather than passing a raw 42703 up, which reads like a
          // broken pipeline instead of a demo whose subject has moved.
          if (e.code === "42703" || e.code === "42P01") {
            throw new Error(
              `preflight: this storyboard asks about something the database does not have.\n  ${e.message}\n  query: ${check.sql}\n  why it matters: ${check.because}\n  The schema has moved since the storyboard was written, or this checkout predates it.`,
            );
          }
          throw e;
        });
      const row = result.rows[0];
      const actual = row ? Object.values(row)[0] : undefined;
      const fail = (why: string) => {
        throw new Error(
          `preflight failed: ${why}\n` +
            `  query: ${check.sql}\n` +
            `  why it matters: ${check.because}`,
        );
      };
      if (check.expect.notNull && (actual === null || actual === undefined)) {
        fail("expected a non-null value, got none");
      }
      if (check.expect.gte !== undefined) {
        const n = Number(actual);
        if (!(n >= check.expect.gte)) {
          fail(`expected >= ${check.expect.gte}, got ${String(actual)}`);
        }
      }
      if (check.expect.eq !== undefined) {
        // Loose compare: pg returns counts as strings.
        if (String(actual) !== String(check.expect.eq)) {
          fail(`expected ${String(check.expect.eq)}, got ${String(actual)}`);
        }
      }
      console.log(`  ok  ${check.because}`);
    }
  } finally {
    await client?.end();
  }
}

/**
 * Return the demo data to its pre-walk state so the next take starts clean.
 *
 * Three takes were needed for the first phase-2 recording and every one of them
 * began with the same hand-typed SQL.
 */
export async function runReset(sb: Storyboard): Promise<number> {
  const statements = sb.reset ?? [];
  if (statements.length === 0) return 0;
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    for (const statement of statements) {
      const result = await client.query(statement.sql, statement.params ?? []);
      console.log(
        `  ${result.rowCount ?? 0} row(s)  ${statement.sql.slice(0, 70)}`,
      );
    }
  } finally {
    await client.end();
  }
  return statements.length;
}
