/**
 * The machine-local config directory:
 * `${XDG_CONFIG_HOME:-~/.config}/<PRODUCT.configDirName>`.
 *
 * Deliberately outside the checkout. It holds the voice config (a path to a TTS
 * binary that must not become a fact this repository depends on), saved browser
 * sessions, and — for demos whose subject is not this product — storyboards and
 * their rendered output. One setup covers every worktree.
 *
 * The name comes from `product.ts` and is `demo-video` in BOTH installs, on
 * purpose: the repo copy and the global copy share one voice config and one
 * session store. Naming it per-product would mean configuring the same voice
 * twice. `migrate()` moves a directory named by
 * `PRODUCT.legacyConfigDirNames` across, once, the first time anything asks
 * for the current name.
 *
 * Only `XDG_CONFIG_HOME` and `HOME` are read here — both are standard and
 * neither needs declaring wherever a product gates its environment reads.
 */
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT } from "../product";

function base(): string {
  return process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "", ".config");
}

export function configDir(): string {
  const target = join(base(), PRODUCT.configDirName);
  if (!existsSync(target)) migrate(target);
  return target;
}

/**
 * Move a pre-rename config directory to the current name, once.
 *
 * A move rather than a fallback read: two directories that both resolve would
 * mean a voice configured in one and a session saved in the other, with no way
 * to tell which a given run used. Best-effort — a failure here leaves the old
 * directory untouched and the tool simply behaves as a fresh install, which is
 * recoverable by hand and never destructive.
 */
function migrate(target: string): void {
  for (const name of PRODUCT.legacyConfigDirNames) {
    const legacy = join(base(), name);
    if (!existsSync(legacy)) continue;
    try {
      renameSync(legacy, target);
      console.log(
        `  moved ~/.config/${name} → ~/.config/${PRODUCT.configDirName}`,
      );
    } catch {
      // Left in place deliberately; see above.
    }
    return;
  }
}
