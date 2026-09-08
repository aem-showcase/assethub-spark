# Invariants (apply throughout — never restated per step)

- **I1 — Outcomes only, never internal terms.** Never expose this skill's
  name, its steps, `intent`, branch/folder mechanics, or tool names
  (`excat`, `da-copy-folder.sh`) to the customer — in prose or in any UI
  you render. Say "give the site a fresh look," "make a copy under the
  company's name," "make the assets easy to find." Avoid jargon the
  customer didn't use — "rebrand," "branch," "publish," "scope."
- **I2 — Never handle raw secrets in chat.** Never accept, echo, or read
  back a pasted token or secret. Tell the customer where to put it; read
  it only from the gitignored file at call time. If a secret appears in
  chat, treat it as compromised — tell them to rotate it (by name only,
  never reproducing the value) and don't use it.
- **I3 — The demo is delivered from the OPEN PR, not a merge.** DA content
  goes live when published; repo code reaches *production* only on merge —
  but the demo does not need production. **Every PR auto-deploys a
  per-branch Cloudflare worker** (`.github/workflows/build.yaml` →
  `spark-eds-pr-<N>` on the `<branch>.dev.frescopamedia.com` route); that
  worker is the demo URL — it does login/auth, proxies the portal search,
  and applies the company scope from the PR's bundled
  `cloudflare/src/config.js`. (The raw
  `https://<branch>--<repo>--<org>.aem.page/companies/<company>/…` is only the
  content origin — no login or search there — so never hand it out as the
  portal.) The result is fully viewable straight from the open PR.
  **Merging is not required and not preferred.** Only call something "live
  in production" once merged; never gate demo completion on a merge.
- **I4 — Deferring asset enrichment is a valid, complete end state.**
  Every demo runs `full` (rebrand + assets are both always in scope), but
  if the customer answers Entry flow Q2 with "leave enrichment for a later
  step," the demo is *done* once rebrand + upload (if applicable) land —
  don't hold the demo open chasing enrichment the customer explicitly
  deferred. This is different from *never* wanting assets — that option no
  longer exists; deferral only postpones *when* enrichment runs.
- **I5 — Never destroy a pull request or its branch.** Never run
  `gh pr close`, `git push --delete`, `git branch -D`, `--delete-branch`,
  or anything that closes/deletes a PR or a branch that has (or had) a PR
  — not on error, not on a "start fresh" request, not to "clean up." An
  open PR is the deliverable (I3). If the customer wants to start over,
  **ask first**, then create a **new** branch and a **new** PR, leaving
  the existing one untouched.
- **I6 — Company key must not collide with site/runtime paths.**
  `customer.companyKey` becomes the DA content folder and portal base path
  **`/companies/<companyKey>`** (foldered demos live under one `companies`
  container so the DA root stays uncluttered — `customer.daFolder =
  "/companies/<companyKey>"`), and the asset folder
  **`/content/dam/<companyKey>`** (the DAM path stays FLAT — assets are scoped
  by the `company` metadata tag, not by URL). Reject empty slugs and reserved
  names such as `companies`, `en`, `ja`, `config`, `public`, `api`, `auth`,
  `tools`, `scripts`, `styles`, `blocks`, `icons`, `media`, and `fonts`.
  Use a specific slug instead, e.g. `acme-demo`.
- **I7 — A fix to a skill file is a skill change, not a demo artifact.**
  Steps 3–6 run in the demo worktree (`demo/<companyKey>` branch), so an edit
  you make there to a file under `.claude/skills/rebrand-portal/` (a script,
  doc, or hook) ships only on that demo's PR — the maintained skill is
  untouched and the **next demo re-hits the same bug**. When a run forces you
  to fix shared tooling (a scraper/classifier/verify bug, not company content),
  land that fix on the maintained skill on the main checkout too, not only on
  the `demo/<companyKey>` branch. A tooling fix that lives only on a demo
  branch is not done.
- **I8 — Publish every copied path, not a hand-picked subset.** Step 3 copies
  the whole site; Step 4's publish must cover **all** of it. After publishing,
  reconcile the published set against everything Step 3 copied (enumerate the
  copied `/companies/<companyKey>/...` paths and confirm each was
  previewed+published) — a page that was copied but never published 404s for
  the customer and is a defect, not "out of scope." Do not maintain the publish
  list by hand from memory.
- **I9 — DA_TOKEN is short-lived; refresh in place, don't stall.** The token
  can expire mid-run, including partway through a single long copy/enrich
  (I2 still applies — never echo or read it back). On a mid-run 401, refresh it
  in **this** worktree's `token.env` and resume the same idempotent step — do
  not send the customer to the main checkout, and do not treat the 401 as a
  dead end. Where a long operation is about to run, a quick token sanity-check
  first beats a 401 halfway through.
  Handle the 401 as **one plain instruction, not a multiple-choice question**:
  "The DA token expired — paste a fresh one into `<worktree>/token.env` and say
  'done', and I'll resume (the copy/enrich is idempotent and skips what already
  landed)." A refreshed token is the only real path (only the customer can mint
  one), so do **not** offer a menu, and never offer "re-copy the token from the
  main checkout" as an option — that re-shares one token across worktrees, which
  I10 forbids. Just ask for the refresh and wait.
- **I10 — COPY worktree secrets, never symlink.** Seed `token.env` and
  `cloudflare/.secrets` into a new worktree as **real copies** (per
  `step-1-2-branch.md`), so each demo owns independent files and two parallel
  demos never share or clobber a token. If memory or prior practice says
  "symlink so refresh propagates," that guidance is stale — follow the doc
  (copy) and flag the conflict in one line; never silently symlink, and never
  defend a symlink setup as correct when asked where to edit — the answer is
  always this worktree's own file.
