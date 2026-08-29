#!/usr/bin/env bun
/**
 * privacy-scan.test.ts
 *
 * A gate that returns "clean" is worthless until you have watched it return
 * "dirty" for the right reason. Every test here feeds `scanFile` content that
 * MUST be caught; the clean cases exist only to pin the false-positive rate,
 * because a gate that cries wolf gets bypassed and then protects nothing.
 *
 * This file necessarily contains the shapes it is testing for, which is exactly
 * why `privacy-gate:allow` exists. Note what is NOT exempted anywhere below: a
 * denylisted term. Those tests use the invented term "acmecorp".
 */

import { describe, expect, test } from "bun:test";
import { scanFile } from "./privacy-scan.ts";

const buf = (s: string) => Buffer.from(s, "utf8");
const labels = (file: string, body: string, deny: string[] = []) =>
  scanFile(file, buf(body), deny).map((f) => f.label);
const clean = (file: string, body: string, deny: string[] = []) =>
  scanFile(file, buf(body), deny).length === 0;

const HOME_PATH = "/Users/somebody/notes.txt"; // privacy-gate:allow
const KEY_BLOCK = "-----BEGIN RSA PRIVATE KEY-----"; // privacy-gate:allow

describe("denylist terms", () => {
  test("a denylisted term in file content is caught", () => {
    expect(labels("skills/X/SKILL.md", "we deploy to acmecorp-prod nightly", ["acmecorp"])).toContain(
      "denylisted term",
    );
  });

  test("term matching is case-insensitive", () => {
    expect(labels("a.md", "AcmeCorp runs the pipeline", ["acmecorp"])).toContain("denylisted term");
  });

  test("word-boundary terms do not fire on a longer word containing them", () => {
    // "acme" must not match "acmeism" — otherwise the list is unusable on short
    // terms and gets pruned until it protects nothing.
    expect(clean("a.md", "acmeism is an art movement", ["acme"])).toBe(true);
  });

  test("the line number points at the offending line", () => {
    const found = scanFile("a.md", buf("clean\nclean\nacmecorp here\n"), ["acmecorp"]);
    expect(found[0]?.line).toBe(3);
  });

  test("with no denylist loaded, term checks simply do not fire", () => {
    expect(clean("a.md", "acmecorp everywhere", [])).toBe(true);
  });

  test("a term is NOT exemptible by an inline allow", () => {
    // The escape hatch is deliberately narrow. A real name never belongs here,
    // however well commented.
    const body = "acmecorp appears here // privacy-gate:allow";
    expect(labels("a.ts", body, ["acmecorp"])).toContain("denylisted term");
  });
});

describe("structural patterns", () => {
  test("a machine-specific home path is caught", () => {
    expect(labels("a.md", `see ${HOME_PATH}`)).toContain("machine-specific home path (use ~/ instead)");
  });

  test("a ~/ path is not a finding — it is the correct form", () => {
    expect(clean("a.md", "see ~/.claude/settings.json")).toBe(true);
  });

  test("a private key block is caught", () => {
    expect(labels("a.md", KEY_BLOCK)).toContain("private key block");
  });

  test("a regex that DESCRIBES a key block is not itself a key block", () => {
    // This exact string lives in PrivacyBoundary.hook.ts and in two skills. If
    // it ever starts matching, the gate blocks its own source.
    expect(clean("a.ts", String.raw`/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/`)).toBe(true);
  });

  test("an inline allow on the same line suppresses a structural hit", () => {
    expect(clean("a.ts", `const p = "${HOME_PATH}"; // privacy-gate:allow`)).toBe(true);
  });

  test("an inline allow on the previous line suppresses a structural hit", () => {
    expect(clean("a.ts", `// fixture. privacy-gate:allow\nconst p = "${HOME_PATH}";`)).toBe(true);
  });

  test("the allow does not leak two lines down", () => {
    // A suppression that drifted would silently disarm the rest of the file.
    expect(labels("a.ts", `// privacy-gate:allow\nconst a = 1;\nconst p = "${HOME_PATH}";`)).toContain(
      "machine-specific home path (use ~/ instead)",
    );
  });
});

describe("credentials", () => {
  test("an Anthropic-style key is caught", () => {
    expect(labels("a.ts", `const k = "sk-ant-api03-${"A".repeat(30)}"`)).toContain("Anthropic-style key");
  });

  test("an AWS access key id is caught", () => {
    // AWS's own documentation example key. privacy-gate:allow
    expect(labels("a.ts", "AKIAIOSFODNN7EXAMPLE")).toContain("AWS access key id");
  });

  test("a GitHub token is caught", () => {
    expect(labels("a.ts", `ghp_${"a".repeat(36)}`)).toContain("GitHub token");
  });

  test("a Slack token is caught", () => {
    // Invented, structurally valid only. privacy-gate:allow
    expect(labels("a.ts", "xoxb-123456789012-abcdefghijkl")).toContain("Slack token");
  });

  test("an inline allow on the SAME line suppresses it", () => {
    expect(clean("a.ts", `const k = "sk-ant-api03-${"A".repeat(30)}" // privacy-gate:allow`)).toBe(true);
  });

  test("an inline allow on the PREVIOUS line suppresses it", () => {
    expect(clean("a.ts", `// fixture. privacy-gate:allow\nconst k = "sk-ant-api03-${"A".repeat(30)}"`)).toBe(
      true,
    );
  });
});

describe("whole-file properties", () => {
  test("an oversized file is caught", () => {
    const found = scanFile("big.md", Buffer.alloc(300 * 1024, 0x61), []);
    expect(found.some((f) => f.label.startsWith("oversized"))).toBe(true);
  });

  test("a file at the size limit is fine", () => {
    expect(clean("ok.md", "a".repeat(256 * 1024))).toBe(true);
  });

  test("a binary extension is caught even when the bytes look like text", () => {
    expect(labels("shot.png", "not actually a png")).toContain("binary file");
  });

  test("NUL bytes are caught even under a text extension", () => {
    const found = scanFile("sneaky.md", Buffer.from([0x61, 0x00, 0x62]), []);
    expect(found.map((f) => f.label)).toContain("binary file");
  });

  test("binary content short-circuits the text checks rather than emitting garbage", () => {
    const found = scanFile("x.png", Buffer.from([0x00, 0x01]), ["acmecorp"]);
    expect(found.map((f) => f.label)).toEqual(["binary file"]);
  });
});

describe("forbidden paths", () => {
  const cases: Array<[string, string]> = [
    ["memory/note.md", "memory belongs in the data tree"],
    ["identity/principal.md", "identity belongs in the data tree"],
    ["goals.md", "goals belong in the data tree"],
    ["sessions/abc/x.json", "session runtime holds transcripts"],
    ["projects/foo/notes.json", "session runtime holds transcripts"],
    ["some/dir/transcript.jsonl", "raw session transcript"],
    [".env", "environment file"],
    [".env.local", "environment file"],
    ["certs/server.pem", "key material"],
    ["skills/_Private/SKILL.md", "private skills are machine-local by convention"],
    [".DS_Store", "macOS noise"],
  ];
  for (const [path, why] of cases) {
    test(`${path} is refused`, () => {
      expect(labels(path, "harmless content")).toContain(`forbidden path — ${why}`);
    });
  }

  test("an ordinary tracked path is not a forbidden path", () => {
    expect(clean("skills/Writing/SKILL.md", "ordinary content")).toBe(true);
  });

  test("a path merely CONTAINING a forbidden name is not refused", () => {
    // `hooks/lib/memory-records.ts` must not trip the `^memory/` rule.
    expect(clean("hooks/lib/memory-records.ts", "ordinary content")).toBe(true);
  });
});
