---
type: llm
criteria: |
  The response must report at least the `a == None` comparison (should be `is None`) as a
  defect. Reporting additional real issues (missing type hints, no docstring, shadowed
  builtin) is fine. A response that fixed the file instead of reporting fails regardless
  of how good the fix is.
focus: last_message
---
