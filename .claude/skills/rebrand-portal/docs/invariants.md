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
  **Never print a secret file to stdout, and never "redact" one.** Do not
  `cat`/`sed`/`awk`/`echo` `token.env`, `cloudflare/.secrets`, or `secret.env`
  to inspect it — a length-bounded regex leaves the rest of a long token intact,
  and redacting a secret is a losing game (multiline, base64, an error path that
  dumps the raw line). Check its *shape* without emitting the value:
  `grep -c '^DA_TOKEN=' token.env` (present?),
  `awk -F= '/^DA_TOKEN=/{print length($2)}' token.env` (length only),
  `wc -c token.env` / `ls -la token.env`, or prove it live with an authenticated
  status probe (`curl -s -o /dev/null -w '%{http_code}' -H "Authorization:
  Bearer $DA_TOKEN" <url>` after `set -a; . ./token.env; set +a`). A `PreToolUse`
  hook (`hooks/guard-secret-read.sh`) blocks the dumping shapes as a second line
  of defense — don't rely on it instead of following this rule.
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
- **I6 — Company key must not collide with site/runtime paths, and must be
  shortcode-safe.**
  `customer.companyKey` becomes the DA content folder and portal base path
  **`/companies/<companyKey>`** (foldered demos live under one `companies`
  container so the DA root stays uncluttered — `customer.daFolder =
  "/companies/<companyKey>"`), and the asset folder
  **`/content/dam/<companyKey>`** (the DAM path stays FLAT — assets are scoped
  by the `company` metadata tag, not by URL). Reject empty slugs and reserved
  names such as `companies`, `en`, `ja`, `config`, `login`, `public`, `api`, `auth`,
  `tools`, `scripts`, `styles`, `blocks`, `icons`, `media`, and `fonts`.
  Use a specific slug instead, e.g. `acme-demo`.
  **Reject a trailing `-<digit>` segment** (`heineken-3`, `acme-2`). The key
  also becomes the icon shortcode `:<companyKey>-icon:`, and AEM's shortcode →
  `<span class="icon">` converter does not handle a `-<digit>-` segment: the
  shortcode ships to the page as literal text. This happened — a header
  rendered the words `:heineken-3-icon:`. Note that `icon-render` will NOT
  catch it, because the SVG file exists and is perfectly valid; the failure is
  in the conversion, not the asset.
  **A `-2`/`-3` suffix belongs on the BRANCH, never on the companyKey.**
  `step-1-2-branch.md` disambiguates repeat demos by branch name
  (`demo/heineken-3`); that suffix must not propagate into `companyKey`, which
  stays `heineken` for every repeat. Conflating the two is what produced the
  broken key.
- **I7 — Publish every copied path, not a hand-picked subset.** Step 3 copies
  the whole site; Step 4's publish must cover **all** of it. After publishing,
  reconcile the published set against everything Step 3 copied (enumerate the
  copied `/companies/<companyKey>/...` paths and confirm each was
  previewed+published) — a page that was copied but never published 404s for
  the customer and is a defect, not "out of scope." Do not maintain the publish
  list by hand from memory.
- **I8 — DA_TOKEN is short-lived; refresh in place, don't stall.** The token
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
  I9 forbids. Just ask for the refresh and wait.
- **I9 — COPY worktree secrets, never symlink.** Seed `token.env` and
  `cloudflare/.secrets` into a new worktree as **real copies** (per
  `step-1-2-branch.md`), so each demo owns independent files and two parallel
  demos never share or clobber a token. If memory or prior practice says
  "symlink so refresh propagates," that guidance is stale — follow the doc
  (copy) and flag the conflict in one line; never silently symlink, and never
  defend a symlink setup as correct when asked where to edit — the answer is
  always this worktree's own file.
- **I10 — No brand colour without provenance.** Every colour that lands in the
  theme must trace to something measured from the customer's real source site.
  `migration-work/brand.json` is that measurement, written by
  `scripts/rebrand/extract-brand.mjs`; each `tokenMap` entry declares
  `source: "extracted"` (the value is one of the measured `tokens.colors`) or
  `source: "derived"` **with** `derivedFrom` naming the measured colour it came
  from. A colour that is neither is a fabrication, and `validateBrand()`
  rejects it.
  This exists because recalling a brand's palette is easy, confident, and
  frequently wrong — and because nothing downstream could previously tell a
  measured colour from a remembered one. Do not hand-write or hand-edit
  `brand.json`; do not clear `gatePassed` to get past a halt. If the source
  cannot be measured (age gate, bot wall, no usable URL), that is a reportable
  outcome to raise with the customer, not a licence to proceed from memory.
  Note that an age gate is usually a *form*, not a wall: `extract-brand.mjs`
  dismisses consent banners and fills country/date-of-birth by itself, and takes
  `--country XX` / `--dob YYYY-MM-DD` when a gate needs a hint. Whatever it did
  is recorded in `provenance.gateInteraction`, and gate detection runs again
  afterwards — so passing a gate can only ever turn a halt into a real
  measurement, never into a false pass. Exhaust that before escalating.
  Measured colour also includes `tokens.accents[]`, not just `tokens.colors`:
  excat samples background/text/link only, which on Heineken is white, grey and
  grey, while the signature green lives on buttons and SVG fills. The accents
  are measured from the same rendered page and are therefore legitimate here.
- **I11 — Copied content is rewritten or deleted — never left as-is.** I7
  guarantees everything copied gets *published*; this guarantees it gets
  *rebranded*. A page copied from the base template and published untouched is
  worse than a missing page, because it looks finished and carries another
  company's content under this customer's name.
  Concretely: no link under `/companies/<companyKey>/` may resolve to a page
  still carrying base-template titles, bodies, or images; and a card retitled
  for the new company must have its **destination** rewritten too, not just its
  label. Retitling a card while leaving it pointing at
  `/companies/<key>/en/brands/north-roast-coffee` is the exact defect that has
  now shipped **twice** — once on a Workday demo and again on a Heineken demo
  nine days later, with the same orphan pages both times. Reconcile the copied
  set against the rewritten set the same way I7 reconciles it against the
  published set, and delete what the demo does not need rather than leaving it
  to be found.
