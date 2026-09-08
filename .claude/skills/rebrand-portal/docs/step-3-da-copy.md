# Step 3 — Copy existing DA content into `/companies/<companyKey>` (`da-content-copied`)

> **Run from the worktree.** This and every later step run with cwd =
> `customer.worktreePath` (the demo's git worktree from Step 2), not the
> main checkout. `copy-folder.sh` reads `token.env` (symlinked into the
> worktree in Step 2) and resolves the repo root from cwd — so running it
> in the worktree targets the worktree's files.

**This step is MANDATORY. It must not be skipped, deferred, or assumed
away.** The demo's whole point is rebranding a *copy of the real DA
content*, so you must actually look at the real content with an
authenticated call — never guess whether it exists. The failure this
prevents: assuming DA is empty (because the checkout has no `fstab.yaml`,
or "it's just a demo") and skipping the copy. **You may conclude DA is
empty only from a real authenticated `list` that returned zero documents.**

This needs `DA_TOKEN` in `token.env` — run Step 4a's token setup now if
`token.env` is absent or unverified. That setup asks the customer for only
`DA_TOKEN`, then runs `ensure-eds-tokens.sh`; the generated/reused
`HLX_ADMIN_TOKEN` is used later for publish.

**Use the packaged script — do not hand-roll `curl`:**

```
.claude/skills/rebrand-portal/scripts/da/copy-folder.sh <org> <repo> <companyKey>
```

`<org>/<repo>` from `git remote get-url origin`; `<companyKey>` the slug
from Step 2. It reads `DA_TOKEN` from `token.env` (never printed) and:

- **Authenticated recursive list** of `/<org>/<repo>`, following the
  `da-continuation-token` paging header — the whole tree, not one page.
- **Recursive folder copy** of **only the three portal content trees —
  `en`, `config`, `public`** (nothing else at the root: no sibling company
  demo folders like `/disney` or `/urbn`, no stray files). `en` carries the
  authored pages plus `nav`/`footer`/`metadata` and the `reports`/`my-dam`
  subtrees; **`public`** carries the login/`welcome` page; **`config`**
  carries site config incl. `config/access` (the access-control sheet).
  Each is copied into `/companies/<companyKey>/...` via
  `POST https://admin.da.live/copy/{org}/{repo}/{path}` (multipart
  `destination` field). The DA copy API is recursive per folder and pages
  large trees with **HTTP 206 + a `continuationToken`** that must be
  re-POSTed until **204** — the script does this loop; a hand-written
  `curl` almost always forgets it and copies only part of the tree. It
  copies, never moves. Re-runs are idempotent (the company folder is
  skipped). (The allowlist is `en config public`; override only via the
  `DA_COPY_ALLOW` env var if a site genuinely has more.)
- **Parallel demos are safe under the shared `companies` container.** Two demos
  running at once write **disjoint** subtrees (`/companies/<keyA>/…` and
  `/companies/<keyB>/…`); DA folders are implicit (a folder is the common prefix
  of its documents — there is no folder object to create), so the container
  materializes when the first doc from either run lands, with no create-order
  race. The script never creates `/companies` explicitly, and the verify pass
  lists exactly `/companies/<companyKey>` (never the bare `/companies`
  container), so a concurrent sibling's in-flight copy can never enter this
  demo's verification set. State is isolated too — each demo has its own git
  worktree and `.internal/onboarding-state.json`.
- **Verification + self-heal** is **path-by-path**, not a count: it re-lists
  `/companies/<companyKey>` and asserts **every** source document (matched *with its
  exact extension*) has a `/companies/<companyKey>/…` counterpart. The extension is
  load-bearing and must be preserved byte-for-byte by the copy: a `.docx`
  must land as `.docx`, and — critically — a DA **sheet** (`config/access/
  application.json`, `companies.json`, `users.json`, notification sheets,
  etc.) **must land as `.json`**. In DA a `.json` is a structured *sheet*
  (editable in the sheet editor, published as `/<path>.json`); an `.xlsx`
  is an opaque *media asset* that opens in the media viewer and is **never**
  published as `.json`. So an access sheet that arrives as `.xlsx` is a
  **broken** copy even though a file is present — it will not publish and
  the portal's auth/permission lookups will 404. Any document the bulk
  folder copy missed — classically the **`config`** subtree carrying the
  **`access`** sheet — is **repaired by an individual per-file copy** from
  its exact source path, preserving the extension (never re-authored, never
  converted to a different type). Only if something is *still* missing after
  the repair does it fail (exit `4`) and list the paths. A count-only check
  is what previously let `public`/`config` come across empty while the total
  still "passed" — never weaken it back to a count, and never hand-author a
  replacement doc in place of the copy.

**Set `daFolder` in state BEFORE the copy — verification gates the STEP,
not the folder value.** `customer.daFolder` is the deterministic destination
(`/companies/<companyKey>`, or the container path — see below), known before any bytes
move. Set it up front, because the packaged copy helper and the publish
guard both read it to scope their checks, and a `null` folder false-blocks
them (the chicken-and-egg: the copy can't run because the guard sees no
folder, but the folder is only "confirmed" by the copy). Setting the folder
is **not** the same as marking the step done: `da-content-copied` stays
`pending` until the copy verifies.

**Exit codes decide what "empty" means — the guard against false-empty:**
- `0` — copied and verified. **Only after exit `0` and the path-by-path
  verification loop completes:** mark `da-content-copied` `done`. (`daFolder`
  was already set up front, per above.) Do not mark `done` before the
  verification loop finishes — an interrupted session would resume past an
  unverified step.
  - **Publish-guard note.** `copy-folder.sh` copies DA content; it does not
    publish, so the publish guard does not gate the copy itself. The guard
    reads `daFolder` (set up front) to scope publishes; it is correct — never
    weaken it. What was previously wrong here was marking the *step* done
    early, not setting the folder early. Setting the deterministic folder
    value up front is expected; marking `da-content-copied` done before
    verification is the thing to avoid.
- `3` — **and only `3`** means genuinely empty (list returned HTTP 200,
  zero documents). Only then may you say there's nothing to copy; say you
  confirmed it via the authenticated list (name the org/repo checked).
- `1` / `2` / `4` — a real failure (bad/expired `DA_TOKEN`, mis-resolved
  org/repo `404`/`403`, copy error, verification mismatch). A `404`/`403`
  is **never** "empty." Do not mark the step done, do not proceed to
  Step 4, do not treat a code-only rebrand as sufficient — fix the
  token/path and re-run.

**Sheet-format check (config/access must be a JSON sheet, not XLSX media).**
After the copy, list `/companies/<companyKey>/config/access` and confirm every entry
is a **`.json`** file:
```
curl -s -H "Authorization: Bearer $DA_TOKEN" \
  "https://admin.da.live/list/{org}/{repo}/companies/<companyKey>/config/access"
```
Each row's `ext` must be `json` (e.g. `application.json`). If you see an
`.xlsx`, the source itself is broken — an `.xlsx` in DA is an opaque *media*
asset (opens in the media viewer, served as `application/octet-stream`) and
is **never published as `/config/access/application.json`**, so the portal's
auth/permission lookups (the worker reads the company-scoped
`fetchHelixSheet(companyBasePath()+'/config/access/application')`) will
`404` and login/gating breaks. A correct sheet is a `.json` in the EDS
sheet shape `{"total":N,"limit":N,"offset":0,"data":[…],":type":"sheet"}`
that opens in DA's **sheet** editor. Do **not** "fix" this by copying an
`.xlsx` — fix the *source* `config/access/*` to be `.json` sheets (the copy
is faithful, so a `.json` source yields a `.json` sheet automatically). Do
not mark `da-content-copied` done while any `config/access` entry is `.xlsx`.

**Nav/UI note.** How the copied pages resolve nav/footer depends on the
project's EDS config (a fixed root `nav` path vs. a per-folder
`metadata`-declared path). If nav resolves from a fixed root path, the
copied `/companies/<companyKey>/nav` won't be picked up without a per-folder
`metadata` override — check the project's `head.html`/metadata convention
and, if needed, write a `metadata` entry on `/companies/<companyKey>` pointing
`nav`/`footer` at the copied docs. Confirm the copied pages render their
nav/footer before treating this step done.

