/**
 * Capture a session out of the browser you are already signed into.
 *
 * `demo:login` opens a fresh Playwright browser and asks you to sign in. That
 * works until the sign-in needs something a fresh browser does not have —
 * Google SSO with a passkey held in a password-manager EXTENSION is the case
 * that broke it here: the extension is not installed in the throwaway profile,
 * so the passkey cannot be presented and there is no way through at all.
 *
 * The insight is that the authentication has already happened. Your real
 * browser holds a valid session for the site; Interceptor can read its cookies
 * (the extension has Chrome's cookies API, so httpOnly cookies included). So
 * instead of re-authenticating, borrow the result — no passkey, no extension,
 * no second factor, no interactive step at all.
 *
 * This is the better path for anything you are already signed into, and it is
 * the only path for a passkey or hardware-key flow. The headed `demo:login`
 * stays for sites you are not signed into.
 *
 * Cookies only, deliberately. localStorage is per-origin and would need a page
 * open on each origin to read; if a site turns out to keep its auth there the
 * walk fails at a sign-in screen, which is a better outcome than a silent
 * half-session that looks authenticated until it is not.
 */
import type { BrowserContextOptions } from "playwright";

type StorageState = Exclude<
  BrowserContextOptions["storageState"],
  string | undefined
>;
type PlaywrightCookie = NonNullable<StorageState>["cookies"][number];

/** What Interceptor returns per cookie (Chrome's cookies API shape). */
interface ChromeCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: string;
}

/**
 * Chrome's `sameSite` vocabulary is not Playwright's, and Playwright rejects
 * anything outside its three. `unspecified` becomes `Lax`, which is what
 * Chrome itself applies to a cookie that does not say.
 */
function sameSite(raw: string | undefined): PlaywrightCookie["sameSite"] {
  switch ((raw ?? "").toLowerCase()) {
    case "no_restriction":
    case "none":
      return "None";
    case "strict":
      return "Strict";
    default:
      return "Lax";
  }
}

export function toPlaywrightCookies(
  cookies: ChromeCookie[],
): PlaywrightCookie[] {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    // Playwright's sentinel for "session cookie, dies with the browser".
    expires: c.session || !c.expirationDate ? -1 : Math.floor(c.expirationDate),
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite: sameSite(c.sameSite),
  }));
}

async function interceptor(args: string[]): Promise<unknown> {
  const proc = Bun.spawn(["interceptor", ...args, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const brace = stdout.indexOf("{");
  if (brace < 0) {
    const prose = stdout.replace(/^\[[0-9a-f]+\][^\n]*\n?/m, "").trim();
    throw new Error(prose || stderr.trim() || "interceptor produced no output");
  }
  const parsed = JSON.parse(stdout.slice(brace)) as {
    success?: boolean;
    data?: unknown;
    error?: string;
  };
  if (parsed.success === false) {
    throw new Error(parsed.error ?? "interceptor reported failure");
  }
  return parsed.data ?? parsed;
}

/** Per-agent tab group, so this never drives a tab you are reading. */
const GROUP = "demo-login";

/**
 * Read cookies for each domain out of the real browser.
 *
 * A tab must be open on the site: Interceptor's cookie read is addressed to a
 * tab it manages, and asking without one fails with "tab N is not in the
 * interceptor". Opening the site is also the cheapest proof that the session
 * being borrowed is actually live.
 */
export async function cookiesFromBrowser(
  domains: string[],
): Promise<{ cookies: PlaywrightCookie[]; perDomain: Record<string, number> }> {
  const all: PlaywrightCookie[] = [];
  const perDomain: Record<string, number> = {};

  for (const domain of domains) {
    await interceptor(["open", `https://${domain}`, "--group", GROUP]);
    const data = (await interceptor(["cookies", domain, "--group", GROUP])) as
      | { cookies?: ChromeCookie[] }
      | ChromeCookie[];
    const raw = Array.isArray(data) ? data : (data.cookies ?? []);
    const mapped = toPlaywrightCookies(raw);
    perDomain[domain] = mapped.length;
    all.push(...mapped);
  }

  await interceptor(["tab", "close", "--group", GROUP]).catch(() => undefined);

  // The same (name, domain, path) from two sites is the same cookie; last wins.
  const seen = new Map<string, PlaywrightCookie>();
  for (const c of all) seen.set(`${c.name} ${c.domain} ${c.path}`, c);
  return { cookies: [...seen.values()], perDomain };
}
