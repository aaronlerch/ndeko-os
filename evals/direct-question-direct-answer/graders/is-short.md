---
type: llm
criteria: |
  This is a one-line factual question. A passing answer states that -p creates parent
  directories as needed (and does not error if the directory already exists), in roughly
  one to three sentences. It fails if it is padded out with sections, headers, a change
  log, verification ceremony, worked examples nobody asked for, or an offer to do
  follow-up work. Correctness alone is not enough — this case measures whether the
  scaffold makes short answers long.
focus: last_message
---
