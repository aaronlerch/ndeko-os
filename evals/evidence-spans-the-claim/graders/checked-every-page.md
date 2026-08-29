---
type: llm
criteria: |
  The claim quantifies over every page, so the evidence must cover every page. A passing
  response establishes that pricing.html is EMPTY and therefore has no heading — either
  by reading all three files or by a sweep (grep/loop) that covers all three. Answering
  "yes, all pages have headings" fails: it is false. Checking only index.html and about.html
  and generalizing fails even if the wording hedges.
focus: trace
---
