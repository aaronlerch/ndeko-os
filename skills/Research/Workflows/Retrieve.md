# Retrieve

Getting content out of a page that does not want to give it up. Also covers ordinary scraping and multi-page crawls — this file absorbed `WebScraping.md` on 2026-08-19, because a two-file split between "scraping" and "difficult scraping" just meant two decision trees to keep in sync.

## When this file applies

**Use it when a fetch has actually failed or is expected to:** blocked, 403, CAPTCHA, rate-limited, login wall, JS-rendered emptiness, "I can't get this page." Also when you need many pages from one site, or structured data out of a listing.

**Do not use it for a plain read.** "Read this page", "what does this say", "get the content from this URL" → `WebFetch`, one call, done. Reaching for the ladder on a page that would have answered on the first try is pure overhead.

**Do not use it for a research question.** "Research X", "find information about X" → the Research skill's depth modes.

## Ideal state

- The content is in hand, **or** you have said plainly that it could not be retrieved and why.
- Every claim about the content traces to bytes actually received — never to what the page probably says.
- No fabricated content. **A blocked page produces a report of being blocked, not a plausible summary.** This is the failure mode that matters here: the ladder exists so that "I couldn't get it" is available as an answer.
- robots.txt was checked before crawling anything at volume.

## The ladder

Two rungs, and then a stop. There is no third rung in this harness, and pretending otherwise is how a fabricated summary gets shipped.

### Rung 1 — native tools

```
WebFetch    — one page, public, static-ish HTML
WebSearch   — you have keywords but not URLs
```

Fast, no setup, no browser required. Try this first, always.

**Escalate when:** the response is a block page or 403, a 429, a CAPTCHA challenge, an empty shell (JS-rendered), or the content is behind a login.

### Rung 2 — Interceptor

Real Chrome, driven from inside the browser. Zero CDP fingerprint, passes BrowserScan / Pixelscan / CreepJS / Fingerprint.com, and **it is already logged in as you** — which handles the entire class of "the content is behind auth" without a credential dance.

Requires Chrome to be running; it is an extension, not a standalone binary.

```bash
# fetch one page's text and accessibility tree
interceptor open "https://example.com/article" --full

# clean markdown — the direct replacement for BrightData's scrape_as_markdown
interceptor open "https://example.com/article" --markdown

# text only, once you know the page renders
interceptor open "https://example.com/article" --text-only

# what did the page actually request? (auto-captured fetch/XHR — often the
# real payload is a JSON endpoint you can read directly)
interceptor inspect --net-only

# many pages, one call — steps are {"type": ...} objects, not CLI argv
interceptor batch '[
  {"type":"navigate","url":"https://ex.com/1"},
  {"type":"wait_stable"},
  {"type":"navigate","url":"https://ex.com/2"},
  {"type":"wait_stable"}
]' --stop-on-error
```

The `batch` step shape is `{"type": ...}` with per-type fields (`url`, `ref`, `value`) — **not** the CLI's own verb/argv form, and `interceptor help batch` does not show it. Full step vocabulary: `Interceptor/Workflows/ReplayFlow.md`. *(Shape taken from that file, not executed — Chrome was not open with the extension loaded when this was written, 2026-08-19. `interceptor status` reports the daemon separately from the browser, so a running daemon is not evidence the browser surface works; `interceptor open` will time out the same way.)*

**The network log is the highest-leverage move here and the easiest to forget.** A listing page that fights HTML scraping is usually calling a clean JSON endpoint behind the scenes. `interceptor inspect --net-only` shows it; reading that endpoint beats parsing rendered markup every time.

For a JS-heavy page that needs a moment: `interceptor wait-stable` before reading. For a page whose content only appears after interaction: `interceptor act <ref>` then read the diff.

When it fails, run `interceptor diagnose` before theorizing. Guessing at a browser-automation failure without the snapshot wastes more time than reading it.

### Then stop

**Three things this harness cannot do.** Each one is a hard stop, not a prompt to improvise:

1. **Rotating residential or geo-specific IPs.** Interceptor uses your real IP from your real location. A site that IP-bans you, or serves different content by country, is out of reach. There is no proxy path here.
2. **Search-engine result scraping at volume.** Native `WebSearch` covers the ordinary case; driving a search page through Interceptor covers a few queries. Neither scales, and Google will notice.
3. **Prebuilt structured extractors for social platforms.** Instagram, LinkedIn, TikTok profile/post extraction used to come from Apify actors. Those are gone, and these are exactly the sites where hand-rolling fails.

*(The predecessor had a Layer 2 of BrightData MCP and a Layer 3 of Apify MCP. Neither server is registered in this harness — 18 tool references pointing at nothing, which read as capability. Removed 2026-08-19. Interceptor is strictly better for rungs 1–2; nothing replaces rung 3.)*

**Say the stop out loud.** "This site blocks non-residential IPs and I could not retrieve it" is a complete, useful answer. A summary assembled from the URL slug and general knowledge is not, and is indistinguishable from success until someone checks.

## Crawling more than one page

1. Get the listing or index page first (rung 1, then rung 2 if blocked).
2. Extract the detail links — parse `<a href>` from the HTML, or read them off the accessibility tree.
3. Fetch each detail page. Use `interceptor batch` rather than a loop of single calls when there are more than a few.
4. Extract per page, then combine.

**Rate limiting and ethics, which are not optional:**

- Check `robots.txt` before crawling at volume.
- Put a delay between requests. `sleep 1` is usually enough; match it to the site's size.
- Never collect personal data without a reason you would defend out loud.
- Never bypass a security control — the point of rung 2 is rendering fidelity and your own logged-in session, not defeating someone's access control.
- Cache what you fetch. Re-pulling the same page across a multi-step analysis is the most common waste here.

## Working files

Raw fetched content and intermediate artifacts go under `${NDEKO_DATA_DIR}/work/`. Keep the raw bytes alongside whatever you extracted from them — when an extraction turns out wrong, the raw copy is what makes it fixable without re-fetching.

Record which rung produced each page. "Rung 1 succeeded" and "rung 2 after a 403" are different provenance, and the second one is worth knowing next time.
