#!/usr/bin/env bun
/**
 * Capture a browser session a demo can replay, by handing you a real browser
 * and saving what you signed into.
 *
 * Invoked as `bun run demo:login` here and as `demo-video login` from a global
 * install; `product.ts` decides which name the messages below print.
 *
 *   <login> acme --from-browser app.acme.com
 *   <login> acme --url https://app.acme.com/login
 *   <login> --list
 *   <login> acme --remove
 *
 * A window opens, you sign in — SSO, MFA, a device prompt, whatever the site
 * asks for — and press Enter here. Cookies and localStorage land in the
 * machine-local sessions dir; a storyboard take names it with `"session"`.
 *
 * You can sign into SEVERAL sites in the one window before pressing Enter.
 * storageState is per-origin, so one session file happily carries all of them —
 * which is what a demo that walks across interconnected sites needs.
 *
 * Nothing here reads a credential, and that is deliberate: an automated login
 * breaks on every auth flow worth demoing, and this way the secret never
 * leaves the password manager.
 *
 * `--from-browser <domain...>` skips the sign-in entirely by borrowing the
 * session your real browser already holds. Prefer it whenever you are already
 * signed in, and reach for it as the ONLY option when the sign-in needs
 * something a throwaway profile cannot have — a passkey in a password-manager
 * extension is the case that forced this: the extension is not installed in
 * the fresh profile, so there is no way through the headed flow at all.
 */
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { chromium } from "playwright";
import {
  describeExpiry,
  listSessions,
  saveSession,
  sessionPath,
  summarize,
} from "./lib/session";
import { cookiesFromBrowser } from "./lib/session-from-browser";
import { PRODUCT } from "./product";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function die(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const name = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];

if (has("list") || (!name && !has("help"))) {
  const names = await listSessions();
  console.log(
    names.length
      ? `\nSaved sessions:\n${names.map((n) => `  ${n}`).join("\n")}\n`
      : "\nNo saved sessions.\n",
  );
  if (!has("list")) {
    console.log(
      `usage: ${PRODUCT.cmd.login} <name> --from-browser <domain...>   borrow a live session
       ${PRODUCT.cmd.login} <name> --url <sign-in page>          sign in by hand
       ${PRODUCT.cmd.login} --list
       ${PRODUCT.cmd.login} <name> --remove
`,
    );
  }
  process.exit(0);
}

if (!name) die("a session name is required");

if (has("remove")) {
  const path = sessionPath(name);
  if (!existsSync(path)) die(`no saved session "${name}"`);
  await unlink(path);
  console.log(`\n✓ removed session "${name}"\n`);
  process.exit(0);
}

// ── borrow the session the real browser already holds ───────────────────────
if (has("from-browser")) {
  const at = process.argv.indexOf("--from-browser");
  const domains = process.argv
    .slice(at + 1)
    .filter((a) => !a.startsWith("--"))
    .map((d) => d.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  if (domains.length === 0) {
    die(
      `--from-browser needs at least one domain.
  e.g. ${PRODUCT.cmd.login} ${name} --from-browser linear.app`,
    );
  }

  console.log(`
Reading cookies for ${domains.join(", ")} out of your real browser.
Interceptor opens each site in its own tab group, so nothing you are looking at
is touched.
`);

  const { cookies, perDomain } = await cookiesFromBrowser(domains).catch(
    (e: Error) =>
      die(
        `${e.message}

  This needs the Interceptor CLI and a browser signed into the site.
  If you are not signed in there, use the interactive form instead:
    ${PRODUCT.cmd.login} ${name} --url <the site's sign-in page>`,
      ),
  );

  if (cookies.length === 0) {
    die(
      `no cookies came back for ${domains.join(", ")} — nothing to save.
  Are you actually signed in there in the browser interceptor drives?`,
    );
  }

  const state = { cookies, origins: [] };
  const summary = summarize(state);
  const path = await saveSession(name, state);
  console.log(`✓ saved session "${name}"
  file      ${path}  (0600)
  cookies   ${Object.entries(perDomain)
    .map(([d, n]) => `${d} (${n})`)
    .join(", ")}
  expiry    ${describeExpiry(summary)}

Use it from a storyboard take:

  { "session": "${name}", "segments": [ … ] }

This is a copy of a live session, not a second one — signing out in the browser
invalidates it too. The file is a bearer token; it stays in the config dir.
`);
  process.exit(0);
}

const url = flag("url");
if (!url) {
  die(
    `--url is required — the page to open for signing in.
  e.g. ${PRODUCT.cmd.login} ${name} --url https://app.example.com/login`,
  );
}

// Headed, and it has to be: the whole point is that a person drives the login.
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.goto(url).catch((e: Error) => {
  console.error(`\n  could not open ${url} — ${e.message}`);
});

console.log(`
A browser is open at ${url}

  1. Sign in. Take as long as you need — MFA, SSO, a device prompt are all fine.
  2. Sign into any other sites this demo will visit, in the same window.
  3. Come back here and press Enter.

Waiting…`);

await new Promise<void>((resolve) => {
  process.stdin.resume();
  process.stdin.once("data", () => resolve());
});

const state = await context.storageState();
await browser.close();

const summary = summarize(state);
if (summary.domains.length === 0) {
  die(
    `nothing was captured — no cookies were set, so this would not log anything in.
  Did the sign-in complete before you pressed Enter?`,
  );
}

const path = await saveSession(name, state);
console.log(`
✓ saved session "${name}"
  file      ${path}  (0600)
  cookies   ${summary.domains.join(", ")}
  storage   ${summary.origins.join(", ") || "(none)"}
  expiry    ${describeExpiry(summary)}

Use it from a storyboard take:

  { "session": "${name}", "segments": [ … ] }

Re-run this command when it expires. The file is a bearer token — it stays in
the config dir, never in the checkout.
`);
