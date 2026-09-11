/**
 * Storyboard target grammar.
 *
 *   button=Continue
 *   text=Your properties
 *   label=CRM phone number
 *   css=[data-slot="cx-property-card"] >> has=Gallerie >> button=Get started
 *
 * Tokens are `kind=value`, chained with `>>` to scope one inside the previous.
 * A value wrapped in slashes is a regular expression: `button=/Get started|Continue/`.
 *
 * Semantics are Playwright's own — `button=` is a role query whose name match is
 * case-insensitive and substring, `text=` is a substring match. When a target is
 * ambiguous, Playwright's strict mode says so and names what matched; scope it
 * with `>>` rather than reaching for a cleverer regex. (A regex that matched both
 * a heading and a sentence is exactly how the first phase-2 walk died.)
 */
import type { Locator, Page } from "playwright";

/**
 * Playwright's own ARIA role union, taken from the signature rather than
 * re-typed, so a Playwright upgrade that adds a role needs no edit here.
 */
type AriaRole = Parameters<Page["getByRole"]>[0];

/** Role tokens that read better than the generic `role=` form. */
const ROLES = {
  button: "button",
  link: "link",
  heading: "heading",
  tab: "tab",
  checkbox: "checkbox",
  radio: "radio",
  textbox: "textbox",
  option: "option",
} as const satisfies Record<string, AriaRole>;

type RoleToken = keyof typeof ROLES;

const isRoleToken = (kind: string): kind is RoleToken => kind in ROLES;

/**
 * `role=` accepts any ARIA role, so the value is a caller-supplied string from a
 * committed storyboard. Playwright validates it and throws a named error on an
 * unknown role, which is a better message than anything this could produce.
 */
const asRole = (role: string) => role as AriaRole;

function value(raw: string): string | RegExp {
  const m = raw.match(/^\/(.*)\/([gimsuy]*)$/);
  return m ? new RegExp(m[1] as string, m[2]) : raw;
}

function base(page: Page, kind: string, raw: string): Locator {
  if (isRoleToken(kind)) {
    return page.getByRole(ROLES[kind], { name: value(raw) });
  }
  switch (kind) {
    case "role": {
      const [role, ...rest] = raw.split(":");
      const name = rest.join(":");
      return name
        ? page.getByRole(asRole(role as string), { name: value(name) })
        : page.getByRole(asRole(role as string));
    }
    case "text":
      return page.getByText(value(raw));
    case "label":
      return page.getByLabel(value(raw));
    case "placeholder":
      return page.getByPlaceholder(value(raw));
    case "title":
      return page.getByTitle(value(raw));
    case "testid":
      return page.getByTestId(raw);
    case "css":
      return page.locator(raw);
    default:
      throw new Error(
        `unknown target kind "${kind}". Known: ${[
          ...Object.keys(ROLES),
          "role",
          "text",
          "label",
          "placeholder",
          "title",
          "testid",
          "css",
        ].join(", ")}`,
      );
  }
}

function descend(parent: Locator, kind: string, raw: string): Locator {
  if (isRoleToken(kind)) {
    return parent.getByRole(ROLES[kind], { name: value(raw) });
  }
  switch (kind) {
    case "has":
      return parent.filter({ hasText: value(raw) });
    case "hasNot":
      return parent.filter({ hasNotText: value(raw) });
    case "nth":
      return parent.nth(Number.parseInt(raw, 10));
    case "text":
      return parent.getByText(value(raw));
    case "label":
      return parent.getByLabel(value(raw));
    case "placeholder":
      return parent.getByPlaceholder(value(raw));
    case "testid":
      return parent.getByTestId(raw);
    case "css":
      return parent.locator(raw);
    case "role": {
      const [role, ...rest] = raw.split(":");
      const name = rest.join(":");
      return name
        ? parent.getByRole(asRole(role as string), { name: value(name) })
        : parent.getByRole(asRole(role as string));
    }
    default:
      throw new Error(`unknown chained target kind "${kind}"`);
  }
}

/** Turn a storyboard target string into a Playwright locator. */
export function resolve(page: Page, spec: string): Locator {
  const parts = spec
    .split(">>")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error(`empty target: "${spec}"`);

  let locator: Locator | null = null;
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 1) {
      // `first` / `last` need no value.
      if (part === "first" && locator) {
        locator = locator.first();
        continue;
      }
      if (part === "last" && locator) {
        locator = locator.last();
        continue;
      }
      throw new Error(
        `target segment "${part}" in "${spec}" is not kind=value`,
      );
    }
    const kind = part.slice(0, eq).trim();
    const raw = part.slice(eq + 1).trim();
    locator = locator ? descend(locator, kind, raw) : base(page, kind, raw);
  }
  return locator as Locator;
}
