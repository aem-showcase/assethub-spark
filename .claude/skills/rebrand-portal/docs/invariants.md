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
  `https://<branch>--<repo>--<org>.aem.page/<company>/…` is only the
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
  `customer.companyKey` becomes both the DA folder (`/<companyKey>`) and
  the asset folder (`/content/dam/<companyKey>`). Reject empty slugs and
  reserved route names such as `en`, `ja`, `config`, `public`, `api`,
  `auth`, `tools`, `scripts`, `styles`, `blocks`, `icons`, and `fonts`.
  Use a specific slug instead, e.g. `acme-demo`.
