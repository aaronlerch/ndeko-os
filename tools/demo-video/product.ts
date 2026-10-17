/**
 * The `product.ts` a global install starts life with — a recorder that belongs
 * to no product and can demo any website on this machine.
 *
 * `sync-global.ts` copies this file to `<install>/product.ts` on the FIRST
 * install and never touches it again, so anything that machine configures
 * afterwards survives every later sync. It lives here, as a real typechecked
 * file rather than a string inside the installer, so it cannot rot unnoticed:
 * a change to the `Product` interface breaks this file in this repo's own
 * typecheck, which is the only place anyone would see it.
 *
 * Everything product-specific is absent by construction rather than stripped —
 * no repo root, no committed storyboard directory, no auth profiles, no
 * database, nothing to publish to. What remains is the generic pipeline:
 * storyboards from the config dir, narration, a walk, an mp4.
 */
import { existsSync, readFileSync } from "node:fs";
import { configFile } from "../../hooks/lib/paths";
import type { DoctorCheck } from "./lib/doctor-check";
import type { Product } from "./lib/product-types";

/**
 * This machine's watermark text, from the data tree's config.toml:
 *
 *   [demo_video]
 *   watermark = "…"
 *
 * Read from there, never written here: the text names who the videos belong
 * to, and this file is committed to a harness that carries no employer name.
 * Absent or unreadable means no default watermark — the doctor says so.
 */
function dataTreeWatermark(): string | null {
  try {
    const path = configFile();
    if (!existsSync(path)) return null;
    const cfg = Bun.TOML.parse(readFileSync(path, "utf8")) as {
      demo_video?: { watermark?: unknown };
    };
    const text = cfg.demo_video?.watermark;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

export const PRODUCT: Product = {
  // The same directory the repo install uses, deliberately: one voice config
  // and one session store shared by both front doors.
  configDirName: "demo-video",

  // Nothing to migrate: a global install has no earlier name.
  legacyConfigDirNames: [],

  // No checkout. Every storyboard is machine-local and renders beside itself.
  root: null,
  storyboardDir: null,

  cmd: {
    record: "demo-video record",
    voice: "demo-video voice",
    login: "demo-video login",
    deps: "demo-video deps",
    doctor: "demo-video doctor",
    glossary: "demo-video glossary",
    publish: null,
  },

  docs: "~/.claude/tools/demo-video/README.md",

  // No local stack to run, so a take that names a `profile` gets no restart
  // instruction — there is nothing to restart.
  stackHint: null,

  databaseHint:
    "DATABASE_URL is not set, and this storyboard has SQL preflight checks.\n" +
    "  Export it for the run:  DATABASE_URL=postgres://… demo-video record <name>\n" +
    "  Or drop the `sql` checks and assert with `url`/`expectText` instead.",

  cloudStubHint:
    "  Implement the openai branch in lib/voice.ts, reading OPENAI_API_KEY\n" +
    "  from the environment. Or configure a local TTS binary instead:\n" +
    "  demo-video voice --help",

  publishTarget: null,

  watermark: dataTreeWatermark(),

  extraChecks: async (): Promise<DoctorCheck[]> => [
    {
      name: "watermark source",
      async run() {
        return dataTreeWatermark()
          ? { ok: true, detail: `[demo_video] watermark in ${configFile()}` }
          : {
              ok: false,
              warn: true,
              detail: "no [demo_video] watermark in the data tree's config.toml",
              fix: `add  [demo_video] watermark = "<text>"  to ${configFile()}`,
            };
      },
    },
  ],
};
