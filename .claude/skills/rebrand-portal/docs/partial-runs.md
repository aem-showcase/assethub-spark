# Partial runs — `rebrand` and `look` (no assets)

This doc governs a demo whose `intent` is **`rebrand`** or **`look`** (not
`full`). It is the companion to `SKILL.md`'s "Capture the intent first"
section. A partial run does the **same mandatory foundation** as a full
demo, runs only the requested part of Step 4, then **stops after the PR** —
it never runs Step 5 (assets) or Step 6 (collections).

> **Read the foundation docs as-is.** A partial run does NOT get its own
> copies of Steps 1–4 — it runs the real ones. Read and follow
> `docs/step-1-2-branch.md`, `docs/step-3-da-copy.md`, and
> `docs/step-4-rebrand.md` exactly as a full demo would, then apply the
> scope narrowing in §3–§5 below. This doc only says *which parts* of Step 4
> run and *where the run stops* — it does not restate their checklists.

## 1. When this applies

`SKILL.md` "Capture the intent first" resolves the intent from the
customer's wording:
- **`look`** — a visual change only: recolour the theme, swap the logo/icon,
  or restyle a named block. Page copy is left as-is; no assets.
- **`rebrand`** — the visual change **and** a page-copy rewrite for the
  brand; no assets.

Two reminders from the router (do not re-litigate them here): the word
**"portal"** and the presence of a **source URL** are NOT signals to widen
to `full`. The URL is the style source Step 4 already uses.

## 2. The foundation is identical to a full demo (do not shrink it)

Run these exactly as `full` does — no exceptions, no "it's only a colour
change" shortcuts:

1. **Step 1 `demo-confirmed`** — plain-language demo framing (I1).
2. **Step 2 `branch-resolved`** — worktree + `demo/<companyKey>` branch,
   existing-branch ask (I5), secrets copied in (I9). (`docs/step-1-2-branch.md`)
3. **Step 3 `da-content-copied`** — **MANDATORY** full DA copy into
   `/companies/<companyKey>`, path-by-path verified, sheet-format checked.
   The one hard gate (`SKILL.md`) forbids any styling edit until
   `branch-resolved` AND `da-content-copied` are `done` — this holds for a
   `look` run too. (`docs/step-3-da-copy.md`)

Why the foundation can't shrink: without the branch there is nowhere
isolated to work; without the DA copy there is no `/companies/<companyKey>`
content to restyle, the login/access sheets are missing, and both the hard
gate and the `demo-and-copy-before-any-design-tool` eval fail; without the
config.js scope + publish + PR there is no working, shareable preview URL —
which is the entire point of a demo (I3).

## 3. Step 4, scoped to the intent

Step 4 (`docs/step-4-rebrand.md`) has three change buckets plus the
scope/publish/PR tail. Run them per the intent:

| Step 4 part | `look` | `rebrand` | (`full` for reference) |
|---|---|---|---|
| item 1 — design tokens / full-palette colour / typography | ✔ if asked | ✔ | ✔ |
| item 2 — logo / icon / favicon swap | ✔ if icons asked | ✔ | ✔ |
| item 3 — content-register **page-copy** rewrite | **skip** | ✔ | ✔ |
| item 3 — **category contract + facet-slug** rewrite | **skip** | **skip** | ✔ |
| `demo-company-set` (config.js scope) | ✔ | ✔ | ✔ |
| publish `/companies/<companyKey>/…` (I7, incl. access sheets) — via `scripts/da/publish-paths.sh` (§4b) | ✔ | ✔ | ✔ |
| land as one PR (I3) | ✔ | ✔ | ✔ |

- **`look` and item 1/2:** apply only the slice in `customer.styleScope`.
  For a colour-only slice, run item 1 (tokens/palette) and skip item 2. For
  an icon/logo slice, item 2's logo rules are **mandatory and unchanged** —
  create both `/icons/<companyKey>-icon.svg` and
  `/icons/<companyKey>-beans.svg`, swap the shortcodes in the copied nav,
  footer, and welcome docs, and replace the favicon; skipping this ships an
  empty-circle header. For a **block** slice, invoke the design tool in its
  individual-block mode for that block only.
- **The category-contract / facet-slug parts of item 3 are always skipped in
  a partial run** — they exist purely to feed the cards+assets vocabulary,
  and a partial run has no assets. The copied index keeps its base category
  cards (still recoloured by item 1, which is branch-global). Do not derive a
  category contract and do not rewrite card facet slugs.
- **`look` leaves page copy as-is:** the copied pages keep the source site's
  prose under the company name. That is expected — the customer asked for a
  look change, not a content rewrite.

## 4. Scoped Step 4g

Run `docs/step-4g-verification.md`, but only the checks that apply to what
changed. `verify.mjs` is informational here (the `guard-step5-verify-gate.sh`
hook never fires, because `enrich-assets.js` is never invoked in a partial
run), yet the visual checks are still the way you prove the change landed —
run them.

- **Run:** `residue`, `structural-residue`, `applied-css`,
  `icon-reference-resolution`, `icon-render`, `header-logo`,
  `welcome-header-home-link`, `nav-404-loop`, the welcome-panel + favicon
  checks, and the login/auth verification (publish happened, so login must
  still work on the preview).
- **Skip:** `card-count`, `hero-quality`, `stale-card-images` — these need
  the Step-5 report, which a partial run never produces.
- **`look` (no content rewrite):** the brand-residue check on the copied DA
  docs still applies to **logo/icon shortcodes** if item 2 ran. But do **not**
  treat surviving source-site product names in **body copy** as a residue
  FAIL — the copy was intentionally not rewritten. (For `rebrand`, item 3 ran,
  so the body-copy residue expectations apply as in a full demo.)

**Run it in two passes with explicit `--only` lists — do not hand-grep.**
`verify.mjs`'s `residue` check already matches **both** the `#rrggbb` form and
the decimal `rgb(r g b)`/`rgb(r,g,b)` form of every captured old hex in one
pass (`checkResidue` in `scripts/rebrand/verify.mjs`). So do **not**
hand-grep for old colours in two forms — that manual sweep is exactly how the
decimal `rgb()` survivors get missed and re-swept. Let the check do it.

- **Pass A — tree-only, immediately after the colour/icon edit** (no preview
  needed; catches residue in both forms, icon/CSS references, logo sizing):
  ```
  node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs \
    --only residue,structural-residue,icon-reference-resolution,icon-render,header-logo,welcome-header-home-link
  ```
  Fix everything it flags **before** committing — this is the one sweep; don't
  defer colour cleanup to a reactive post-deploy pass.
- **Pass B — after the branch preview deploys** (needs `--preview`):
  ```
  node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs \
    --preview <branch>.dev.frescopamedia.com --company <companyKey> \
    --only applied-css,nav-404-loop
  ```
This hits the network only once (Pass B), after the cheap tree checks are
already green.

## 4b. Publish + shell discipline — don't lose minutes to self-inflicted stalls

A look run should reach the open PR in a few minutes. The live eBay run took
~28 because the agent broke its own commands, **misread the failures as an
expired token** (it wasn't — the token was valid the whole time), leaked the
token with `bash -x`, and hand-rolled a DA call that 403'd for lack of a
browser User-Agent. All of that is avoidable:

- **Publish with the packaged helper, not hand-rolled curl/Python:**
  ```
  .claude/skills/rebrand-portal/scripts/da/publish-paths.sh <org> <repo> <companyKey>
  ```
  It enumerates every copied `/companies/<companyKey>/…` doc and previews +
  publishes each with explicit literal paths (`REF=main`), **sends a browser
  User-Agent on every DA/Helix call** (so the `admin.da.live` 403-without-UA
  failure never appears — Python `urllib` hits this, curl does not), verifies
  the token once up front, and forwards `DA_TOKEN` as `Authorization`, retrying
  with `x-content-source-authorization` on a 401. `--dry-run` lists what it
  would publish. This satisfies `guard-da-publish.sh` (literal per-path URLs)
  and covers I7 (everything copied is published). **Do not** hand-roll the
  enumerate/publish loop — that is what produced the 403-guess-retry spiral.

- **A 403/401 is NOT proof the token expired.** Before ever telling the
  customer a token is expired, **prove it** with the one-line status probe:
  ```
  set -a; . ./token.env; set +a
  curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $DA_TOKEN" \
    "https://admin.da.live/list/<org>/<repo>"
  ```
  A `200` means the token is fine and the failure is in **your** command (a
  bad heredoc, a missing UA, a malformed path) — fix the command, do **not**
  ask for a refresh. Only a non-200 here justifies the one-line I8 refresh
  ask. (`publish-paths.sh` runs exactly this probe first, so a genuine expiry
  surfaces once, up front, not mid-loop.)

- **Never `bash -x` / `set -x` a command that sources `token.env`** — it
  prints the token (invariant I2). Debug with the status-banner + `curl
  -w '%{http_code}'` probe above.

- **Use guard-safe shell shapes** (so `guard-secret-read.sh` doesn't block you
  and force a retry): write DA helper scripts as **files**, not heredocs that
  source `token.env` inline; check a token's presence/shape with
  `grep -c '^DA_TOKEN=' token.env`, `wc -c token.env`, or `ls -la token.env`
  (never a bare `grep`/`cat`/`sed` of the file); and don't combine a `cp` with
  a `grep`/`cat` of the secret in one compound command — the guard scans the
  whole command string.

## 5. Stop after the PR — and offer, don't gate

Once the PR is open and the scoped 4g passes:
- Mark the run's asset/collection steps **`not-applicable`** (a `look` run
  also marks the content half of the work not-applicable — the `rebranded`
  step itself is `done` with only its visual buckets run). See the state
  file in `SKILL.md`.
- Deliver the completion report + portal link (I1, outcomes only), exactly
  as Step 4g's report does, adding one plain sentence on what was
  intentionally left out: e.g. *"This updates the portal's look; I haven't
  brought in your assets."*
- **End with a one-line offer, not a question that blocks:** *"Want me to
  also bring in and organize your assets so people can search them?"* If the
  customer says yes, this becomes a normal assets follow-up: flip the four
  asset steps from `not-applicable` to `pending`, ask Q1 (and Q2 if
  enrich-existing) as the first action of Step 5, and run Steps 5–6 — the
  same resume path a deferred-assets `full` demo uses.
- **Never ask Q1/Q2 during the partial run itself** — Step 5 is not running,
  so the asset questions have no place yet.

## 6. Invariants and hooks — unchanged

Everything in `docs/invariants.md` (I1–I9) applies verbatim. In particular:
the PR is opened, never merged or deleted (I3, I5); publishing stays scoped
to `/companies/<companyKey>/…` (I7, enforced by `guard-da-publish.sh`);
secrets are never echoed (I2 — including the `-x`-tracer ban). No hook
behaves differently for a partial run — the difference is only in which steps
the agent chooses to run, and that a partial run uses the packaged
`publish-paths.sh` helper (§4b) rather than hand-rolled publish calls. The
full demo's own publish path (`docs/step-4-rebrand.md`) is unchanged.
