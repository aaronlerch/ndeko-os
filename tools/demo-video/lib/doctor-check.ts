/**
 * The shape of one readiness probe.
 *
 * Types only, and no imports — `product.ts` depends on this file and most of
 * `lib/` depends on `product.ts`, so anything with a runtime import here would
 * close a cycle.
 *
 * A check reports rather than throws, because the point of the doctor is to
 * show every problem at once. A run that stopped at the first failure would
 * make the person fix things one round-trip at a time, which is the experience
 * `checkTooling` already avoids by collecting its problems.
 */
export interface CheckResult {
  ok: boolean;
  /** What was found, in a few words. Always shown. */
  detail: string;
  /** The specific command or action that fixes it. Shown when not ok. */
  fix?: string;
  /**
   * Not ok, but not fatal either — the pipeline still records. Publishing
   * credentials and the client-access seed are both this: absent, they cost
   * you one capability, not the run.
   */
  warn?: boolean;
}

export interface DoctorCheck {
  name: string;
  run(): Promise<CheckResult>;
}
