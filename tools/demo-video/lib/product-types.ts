/**
 * The contract every install of this pipeline fills in — the shape of
 * `product.ts`.
 *
 * Generic, and copied verbatim into the global install, which is exactly why it
 * cannot live in `product.ts` itself: that file is the one thing each install
 * owns a different version of, and a type defined there could not be imported
 * by the file that replaces it.
 */
import type { DoctorCheck } from "./doctor-check";

export interface Product {
  /**
   * Directory under `${XDG_CONFIG_HOME:-~/.config}` holding the voice config,
   * saved sessions, and storyboards whose subject is not this product.
   *
   * Deliberately NOT product-named: the repo install and the global install
   * share it, so a voice configured once works from both. A per-product name
   * would mean configuring the same voice twice and wondering why one of them
   * sounds like a robot.
   */
  configDirName: string;

  /**
   * Directories this install's config used to live in, so a rename can move
   * the old one across once. Per-product history, which is why it is here and
   * not a constant in `lib/config-dir.ts`.
   */
  legacyConfigDirNames: string[];

  /**
   * Checkout root, when this install lives inside one. Used to print paths the
   * way a human reads them and to decide whether rendered output can be
   * published in place. `null` for an install that belongs to no repo.
   */
  root: string | null;

  /**
   * Absolute directory of committed storyboards — demos of THIS product, which
   * are reviewable source and re-renderable when the UI moves. `null` for an
   * install with no such home, where every storyboard is machine-local.
   */
  storyboardDir: string | null;

  /** How each CLI is invoked from this install, for use in messages. */
  cmd: {
    record: string;
    voice: string;
    login: string;
    deps: string;
    doctor: string;
    glossary: string;
    /** `null` where this install has nowhere to publish to. */
    publish: string | null;
  };

  /** Where the storyboard format is documented, as a human-readable pointer. */
  docs: string;

  /**
   * Printed when a take names an auth profile, to say how the stack should be
   * running for it. `null` where there is no local stack to run — a demo of
   * someone else's website has no profile to switch and telling its author to
   * restart a server is noise that reads like a prerequisite.
   */
  stackHint: ((profile: string) => string) | null;

  /** How `DATABASE_URL` is expected to reach the process, for SQL preflight. */
  databaseHint: string;

  /** What it would take to turn the cloud voice tier on from this install. */
  cloudStubHint: string;

  /**
   * Where `publish.ts` uploads to. `null` for an install with nowhere to
   * publish. Neither id is a secret — they name a private shared drive that
   * still requires membership to read — but they are facts about one company's
   * Drive, so they live here rather than in the uploader.
   */
  publishTarget: { rootFolderId: string; sharedDriveId: string } | null;

  /** Doctor probes that only make sense for this product. */
  extraChecks: () => Promise<DoctorCheck[]>;
}
