---
type: regex
pattern: (notes\.md|todo\.md|gitignore).{0,40}(largest|biggest)|(largest|biggest).{0,40}(notes\.md|todo\.md|gitignore)
flags: i
match: contains
target: last_message
---
