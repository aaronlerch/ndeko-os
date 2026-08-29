# Verification rules

> **The one home of the seven incident-derived verification rules.** The system prompt keeps the constitutional core resident — no done-claim without tool evidence, the pre-done self-check, confidence-requires-a-source — and points here. The Algorithm's claims 6 and 8 bind these into runs. Nothing else restates them.
>
> Load this file when: verifying web or UI output · making a claim about appearance · deleting or replacing live infrastructure · verifying anything that must expire or propagate · when a verifier is unavailable.
>
> Enforced by `~/.claude/hooks/VerificationGate.hook.ts`.

Browser-verify web output through the **Interceptor** skill before showing it to Aaron — real Chrome, real sessions, accurate rendering. "curl returned 200" is not verification. Playwright is not sanctioned; if tempted, fix Interceptor instead.

## The seven rules

**1. Modality fidelity — the probe exercises the same path the user does.**
A web or UI claim closes only on a real browser navigation to the actual URL. A `curl`, a DOM read of a *different* page, or a check of a sibling path is a different request and proves nothing about what a browser renders at the path in question — curl and a real browser can receive literally different pages. "I curled it and got the right thing" is not "the user's browser gets the right thing."

**2. An unavailable verifier means DEFER, never substitute.**
When the verifier is wedged or down, the claim is not verified. Say "deployed, not browser-verified," mark it `[DEFERRED]`, and do not claim live / works / shipped / fixed. Fix the verifier, wait, or hand the step to a human. Never relabel weaker evidence as verification.

**3. Appearance is not existence — look at pixels, from a faithful renderer.**
A DOM read proves an element *exists* at coordinates. It proves nothing about how it looks. And pixels only count when the render path has fidelity to what the user's device actually paints: a DOM-reconstruction capture does not paint UA default widget chrome (a bare `<button>`'s background), CSS pseudo-element content, or property-set input values — so a contrast bug can look fine in it and render white-on-white on a real phone.

Any claim about native form-control appearance or about **contrast** closes on a true pixel capture or a `getComputedStyle` probe, never a DOM render alone. Any claim about appearance at all — an image renders, is centered, is transparent, is the right color, "looks right" — closes only on a **non-degenerate pixel image you actually looked at.** A black frame is not a look. View every asset before wiring it in.

**4. Reproduce before fixing.**
For any reported UI or page bug: open the page first. Before reading code, before theorizing, before writing a fix. Check console errors. Check network 404s. See the failure. Code analysis without reproduction is speculation, not debugging.

**5. Temporal fidelity — probe when the failure can exist.**
For cache-mediated surfaces (DNS, certificates, CDN caches, negative caches) a probe at T+0 rides warm caches and proves nothing about steady state. A claim about DNS, certificate, or routing state closes on the provider's records API or the authoritative nameserver (`dig @<zone-ns>`), never solely on a request that succeeded through a resolver cache. If only runtime probes are possible, the claim holds `[DEFERRED]` until a re-probe after the TTL — and the watcher gets named before the run closes.

**6. Cache fidelity — a cache can sit between the probe and the truth in three distinct places.**
Rule 5 covers the response path. All three layers have produced a passing probe over a broken system:

- **Response path.** A liveness or health endpoint must answer `no-store` (both `Cache-Control` and `CDN-Cache-Control`), and that header is itself a claim needing a probe. Caught live: two probes seconds apart returned byte-identical bodies while the underlying flow was failing. A cached 200 during an outage is exactly the failure the endpoint exists to catch.
- **Deploy path.** A single post-deploy probe reads whichever edge copy answered. **Verification converges or it does not count** — repeat until N consecutive identical results, and never report a fix on one probe.
- **Data path.** Storage reads may be cached too, so behavior that depends on a value *expiring* cannot be verified from code. Make expiry structural — rotate the key or the query so a new period reads a key that cannot exist — rather than trusting a TTL on the read path.

The through-line: **a mock cannot reproduce a cache.** Unit tests over a faked store prove the logic, never the deployment.

**7. Restore-parity on replace or delete — enumerate ownership before *and* after.**
Changing or deleting anything serving live traffic or producing a flowing metric requires all four:

- The flow's **baseline captured before** the change — a rate over a stated window, plus an inventory.
- What the resource **owns**, enumerated through the provider's authority API before the operation (Cloudflare Workers custom domains: `GET /accounts/{id}/workers/domains`; DNS: `GET /zones/{id}/dns_records`). A dependent record "already existing" is not evidence it survives the delete — managed records look identical to independent ones in a zone listing and die with their owner.
- The **authority re-listed after** the operation. A runtime probe through a warm cache is not the authority.
- Post-change evidence the **flow continues at baseline** within stated tolerance. One synthetic event landing is an example claim and never closes parity; "flow continues at baseline rate" is the universal claim that catches the outage.

A safety mitigation written as prose has no teeth — promote it to a claim with a falsifier *before* the operation executes. Metered pipelines hold `[DEFERRED]` until a delayed delta check against baseline.

## Evidence coverage — the probe set spans the claim

When a claim quantifies over a container — a site, a corpus, a fleet, a data set — **the container passing is not evidence for its members.** The probe set touches every member *type* the user actually consumes, one rendered or executed instance each, with a deterministic gate sweeping the rest where one exists. Shell pages and HTTP 200s verify nothing on a single-page app.

**Viewport is a member type.** A shipped UI change verifies at a mobile width in addition to desktop, or the claim says "desktop-verified only" out loud.

## Briefing a verifier — steps and evidence, never the expected result

A verification or audit brief carries the steps to execute and the evidence to return, never the answer it is expected to find. A verifier told what the pass looks like rationalizes its way to that pass instead of driving the actual path; withholding the expected result forces it to produce real evidence.

This is why an independent second look (Algorithm claim 9) restates the goal and the claims but not the build plan or the "should be" outcome.
