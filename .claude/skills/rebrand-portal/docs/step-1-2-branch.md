# Step 1 — Confirm it's a demo (`demo-confirmed`)

Before anything mechanical, tell the customer in one plain sentence what
will happen: you'll make a copy of the site under their company's name,
give it their look and content, and share it as a portal link — the
original is never changed (I1, no internal terms). Mark `demo-confirmed`
`done`.

---

# Step 2 — Company and branch (`branch-resolved`)

**Resolve the company name → `customer.name`**, and its slug →
`customer.companyKey` (e.g. Disney → `disney`). If the entry answer named
a brand, use it; otherwise ask now. Apply I6 here: if the slug is empty or
reserved, pick a non-colliding company slug such as `<brand>-demo` before
creating any branch, DA folder, or AEM asset folder.

Resolve `{org}/{repo}` from `git remote get-url origin` — this shared
showcase repo itself, not a fork. The demo branch is `demo/<companyKey>`.

**The demo runs in its own git worktree, not the main checkout.** Each
demo gets a dedicated worktree + branch so multiple demos build in
parallel without branch-switch contention or a shared working tree, and
the checkout you invoked from is never switched or dirtied. Worktree path
convention: `../assethub-spark.worktrees/demo-<companyKey>` (grouped under
one `.worktrees` dir, sibling to the checkout so it's outside the tracked
tree; `demo-` prefix makes it self-documenting). The main checkout's root
is `git rev-parse --show-toplevel` (call this `<mainRoot>`).

**Always check for an existing brand branch first, and ASK if one is
found — never silently reuse or recreate it.** Check local and remote:

```
git branch --list "demo/<companyKey>"
git ls-remote --heads origin "demo/<companyKey>"
git worktree list        # a branch already in a worktree can't be re-checked-out
```

- **None exists** → create the worktree with a new branch off `origin/main`:
  ```
  git worktree add ../assethub-spark.worktrees/demo-<companyKey> \
    -b demo/<companyKey> origin/main
  ```
- **One exists** → **stop and ask the customer** (do not choose for them;
  never delete it — I5):
  - **Continue on the existing one** — attach it to a new worktree and
    keep building (its open PR keeps updating):
    ```
    git worktree add ../assethub-spark.worktrees/demo-<companyKey> \
      demo/<companyKey>
    ```
    If that branch is *already* checked out in a worktree (`git worktree
    list` shows it), reuse that existing worktree's path — do not try to
    add a second (git refuses).
  - **Start a fresh one** — create a new, non-colliding branch
    (`demo/<companyKey>-2`, `-3`, …) in its own worktree
    (`../assethub-spark.worktrees/demo-<companyKey>-2`), leaving the
    existing branch/worktree and its PR intact.
  Ask in plain outcome language (I1), e.g. "I already have a version of
  Disney's copy in progress — keep building on that one, or start a
  brand-new one and leave the existing as-is?" Honor the answer.

**Seed the gitignored secrets into the worktree (copy — each worktree is
fully independent).** A fresh `git worktree add` starts without `token.env`
(DA_TOKEN, used from Step 3) or `cloudflare/.secrets` (asset creds, used
from Step 5) — both are gitignored, so git does not carry them. **Copy**
them in (do not symlink): each demo owns its own real files, so two
concurrent demos never share or overwrite each other's secrets or state.

```
cp <mainRoot>/token.env \
  ../assethub-spark.worktrees/demo-<companyKey>/token.env
cp <mainRoot>/cloudflare/.secrets \
  ../assethub-spark.worktrees/demo-<companyKey>/cloudflare/.secrets
```

(If `token.env` doesn't exist yet in `<mainRoot>`, Step 4a creates it in
the worktree directly — copy only if it already exists. If a DA_TOKEN
expires mid-run, refresh it in *this* worktree's `token.env`; it doesn't
propagate to or from any other worktree, by design.
`.internal/onboarding-state.json` is likewise never seeded: each worktree
keeps its own fresh per-demo state record.)

Record the chosen branch in `customer.demoBranch` and the worktree path in
`customer.worktreePath`. **All rebrand code edits and every later step
(3–6) run with cwd = the worktree** — the packaged scripts resolve the
repo root from cwd, so running them there targets the worktree's files.
Mark `branch-resolved` `done`.

**Cleanup (not now).** The worktree lives through Steps 3–6 (assets need
it). Remove it only when the demo is fully done or abandoned:
`git worktree remove ../assethub-spark.worktrees/demo-<companyKey>`. The
branch and its open PR survive removal — never delete the branch (I5).
