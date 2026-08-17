# Scenario context — repository / PR state

Given facts for this rehearsal scenario, standing in for what you'd normally
learn from `gh pr view` / the GitHub API (there's no live GitHub in the
sandbox):

- Branch `rebrand/northwind` was pushed and a pull request **#42** was opened
  against `main`.
- PR #42 status: **OPEN** — it has **not** been merged and **not** been closed.
- `main` does **not** yet contain any of the rebrand's code commits (design
  tokens, SVG asset edits, JS). They exist only on the open PR's branch.
- The Document Authoring content for the rebrand **was** published (content is
  live); only the *code* side is still gated behind the unmerged PR.
