# Plan: move foldered demos under `/companies/<companyKey>` (DA de-clutter)

> **Status: IMPLEMENTED on `rebrand-improvements` (2026-09-08).**
>
> | Change | What landed | Validated |
> |---|---|---|
> | C1 — copy dest | `copy-folder.sh` `DEST_ROOT=companies/$COMPANY`; verify/repair list nested; `companies` reserved | `bash -n`; guardrails tests |
> | C2 — DEMO_BASE_PATH/basePath | `constants.js` `companyBasePath()` + `COMPANIES_CONTAINER`; `enrich-assets.js` uses it (facet hrefs + config patch) | company-base-path test |
> | C3 — browser parser | `locale-utils.js` two-segment base (`detectCompanyBaseFromPath`); nested-only | 10 new dom tests (incl. getCurrentLocale=ja not "companies") |
> | C3b — facets locale | `facets/index.js` `getLocaleFromUrl` → shared `getCurrentLocale` | dom tests |
> | C4 — guard + reserved | `guard-da-publish.sh` copy-arg → `/companies/`; `companies` in reserved sets | guardrails tests updated |
> | C5 — state daFolder | single source `/companies/<companyKey>` (docs + guard read it) | — |
> | C6 — docs | step-3/4/4g/5, SKILL.md, invariants nested; DAM path stays flat; config.js comment | grep (0 double-nest, 0 nested-DAM) |
> | C7 — tests | locale-utils.dom.test.js (10), company-base-path.test.js (2); guardrails updated | all green |
> | C8 — parallel safety | step-3 note (implicit folders, verify lists exact `/companies/<key>`) | doc |
>
> DAM asset path (`/content/dam/<companyKey>`) and worker routes deliberately
> unchanged. All suites green (665 unit + 68 dom + 442 worker), lint 0 errors.
> **MUST-VERIFY (C8) still open:** whether DA holds a real object at the
> `/companies` folder level that concurrent writers could clobber — needs one live
> DA probe (no live DA in the implementation session). The implicit-folder analysis
> and the exact-list guard make it safe under the likely model.

> **Original plan (below) — for traceability.** Every claim traced to `file:line`
> on `rebrand-improvements` (current tree).

## Goal

Today each demo copies the whole site to a **top-level** DA folder
`/<companyKey>` (`/workday`, `/apple`, …). N demos = N siblings cluttering the
DA root next to the real content trees (`en`, `config`, `public`). Move them all
under one **container folder**: `/companies/<companyKey>/…`. The DA root then
holds `en`, `config`, `public`, and a single `companies` folder.

## Key scoping decisions (what does and does NOT change)

Established by reading the code:

- **The worker is already parameterized.** `companyBasePath()`
  (`config.js:68-73`) is just a normalized `DEMO_BASE_PATH`; every worker path is
  `${companyBasePath()}/...`. The worker does **not** assume one segment — set
  `DEMO_BASE_PATH = '/companies/workday'` and the root redirect, login route,
  `LOGIN_PAGE`, access-sheet lookups, and logout redirect all follow. **No
  worker route logic changes** except confirming the `/en/*`,`/ja/*` self-heal
  redirects still behave (they prepend BASE, so they do).
- **The browser URL parser DOES assume one segment — this is the main work.**
  `scripts/locale-utils.js` derives the company base by splitting the path and
  requiring `/<company>/<locale>/…` (seg1 = non-locale, seg2 = locale;
  `getBasePrefix():64-84`, `hasLocalePrefix():92-99`, `getExplicitLocalePrefix():136+`).
  With `/companies/workday/en/…`, `seg1='companies'`, `seg2='workday'` (not a
  locale) → derivation breaks. **This must learn a two-segment base.**
- **The DAM asset folder does NOT change.** Assets live at
  `/content/dam/<companyKey>` (`assets/config.js:175`) and are scoped by the
  `company` **metadata tag** (`DEMO_COMPANY`), not by URL. Keep it flat — no
  Step 5 upload/enrich/collection path changes. Only the **facet-href basePath**
  in Step 5 changes (it's a URL, not a DAM path).
- **`DEMO_COMPANY` stays `<companyKey>`** (the metadata scope). Only
  `DEMO_BASE_PATH` gains the `/companies/` prefix.

So the change is: **DA copy destination + `DEMO_BASE_PATH` value + the browser
URL parser + facet-href basePath + guard/reserved-key + docs.** Not the worker
routes, not the DAM pipeline.

---

## Change set

### C1 — DA copy destination → `/companies/<companyKey>` *(P0)*
**File:** `.claude/skills/rebrand-portal/scripts/da/copy-folder.sh`
- Line **187**: `dest="/$ORG/$REPO/$COMPANY/$1"` → `dest="/$ORG/$REPO/companies/$COMPANY/$1"`.
- The verify/repair pass re-lists `recursive_files "$COMPANY"` (`:259, :279`) → must
  list `companies/$COMPANY` and strip `companies/$COMPANY/` (not `$COMPANY/`).
- State-consistency check (`:68-69`) compares against `daFolder` — it must now
  expect `/companies/$COMPANY`. Either introduce `CONTAINER="companies"` (a
  single const) and build every path from it, or add a `--container` flag
  (default `companies`) for future flexibility. **Recommend a single const**;
  simpler, and a flag no one sets is scope creep.
- Reserved-key list (`:49`) — `companies` is now itself a top-level name; add it
  to `RESERVED_COMPANY_KEYS` so no company is ever keyed `companies`.

### C2 — `DEMO_BASE_PATH` value → `/companies/<companyKey>` *(P0)*
**File:** `.claude/skills/rebrand-portal/scripts/assets/enrich-assets.js`
- Line **540**: `DEMO_BASE_PATH: '/${customerKey}'` → `'/companies/${customerKey}'`.
  (`DEMO_COMPANY:` at `:536` stays `'${customerKey}'` — metadata scope, unchanged.)
- Line **427**: `basePath: '/${customerKey}/en'` → `'/companies/${customerKey}/en'`
  (drives facet-card hrefs via `categorySearchUrl`).
- Confirm `categorySearchUrl(slug, { basePath })` (`category-plan.js`) just
  concatenates basePath — it does, so no logic change, only the value.
- The Step 4 manual edit (docs) sets the same value by hand for the pre-asset
  preview — update the doc instruction (C6).

### C3 — Browser URL parser learns a two-segment base *(P0 — the real risk)*
**File:** `scripts/locale-utils.js` (app code, `main`)
- `getBasePrefix()` (`:63-84`): currently detects `/<company>/<locale>/…`. Add
  detection of `/companies/<company>/<locale>/…`: when `seg1 === 'companies'` and
  `seg3` is a locale, base = `/companies/${seg2}`. Keep the old single-segment
  branch for backward compat (existing `/frescopa`-style or root). Prefer:
  **derive the base from `DEMO_BASE_PATH` injected at build time** rather than
  re-parsing — but the browser has no config import today (it parses the URL by
  design for boundary pages). Simplest correct fix: generalize the parser to
  "strip a known container prefix, then apply the existing seg-is-locale logic."
- `hasLocalePrefix()` (`:91-99`), `getExplicitLocalePrefix()` (`:135+`),
  `getLocaleRedirectUrl()` (`:110+`) all reuse `seg1/seg2` — audit each for the
  two-segment case; they must treat `/companies/<company>` as the base and look
  for the locale at the **next** segment.
- **This is the highest-risk item**: get it wrong and every localized link,
  locale redirect, and 404 boundary-page link on a foldered demo breaks. Needs
  unit tests over both `/frescopa/en/…` (root/legacy), `/companies/x/en/…`, and
  boundary (`/companies/x/404.html`, root `/`).
- **Decision needed (see question):** support BOTH shapes (legacy flat +
  new nested), or migrate wholesale to nested-only? Supporting both is safer for
  any in-flight demos but adds parser complexity.

### C4 — Publish guard + reserved keys *(P1)*
- **`hooks/guard-da-publish.sh`**: it reads `daFolder` from state (`:109`) and
  checks path containment — **works unchanged** if `daFolder` becomes
  `/companies/workday` and publish paths match. But the **copy-helper arg regex**
  (`:195-205`) enforces the `<companyKey>` arg against `daFolder`; update it to
  expect the `companies/<key>` destination the copy script now writes.
- **`copy-folder.sh:49`** and **`assets/config.js` `RESERVED_CUSTOMER_KEYS`** and
  **`invariants.md` I6 (`:44-45`)**: add `companies` to every reserved list.

### C5 — State: `daFolder` value *(P1)*
- `daFolder` in `.internal/onboarding-state.json` becomes `/companies/<companyKey>`
  (set before the copy per Round-3 FIX 10). The guard, the copy script's
  state-consistency check, and Step 4/4g all read it — so the **single source of
  truth is `daFolder`**; keep the value there and derive, don't re-hardcode
  `/companies/` in five places. (Ties into round5's de-hardcoding principle.)

### C6 — Docs: every `/<companyKey>` → `/companies/<companyKey>` *(P1)*
Files and the nature of each edit:
- **`step-3-da-copy.md`** — the copy lands under `/companies/<companyKey>`; the
  allowlist (`en config public`) and verification narrative are unchanged in
  substance, only the destination path. Update every `/<companyKey>/…` example.
- **`step-4-rebrand.md`** — content-register rewrite scope, publish path list,
  `DEMO_BASE_PATH` manual-edit value, internal-link rescoping
  (`/en/…` → `/companies/<companyKey>/en/…`), sign-in link note. Many `/<companyKey>/`
  occurrences.
- **`step-4g-verification.md`** — every preview URL, link-scope check, nav-scope
  check, folder-scope check → `/companies/<companyKey>/…`.
- **`step-5-assets.md`** — facet-href examples, card-link scope → `/companies/…`.
  (DAM `/content/dam/<companyKey>` stays flat — call this out explicitly so no one
  "helpfully" nests it.)
- **`invariants.md` I6** — clarify: companyKey → DA folder is now
  `/companies/<companyKey>` (DAM stays `/content/dam/<companyKey>`); `companies`
  is reserved.
- **`SKILL.md`** — any top-level `/<companyKey>` routing description.

### C8 — Parallel-demo safety on the shared `/companies` container *(P1 — new)*
**Why this is new:** flat demos copy to **disjoint top-level** folders
(`/workday`, `/apple`) — no shared parent is created, so two parallel runs never
contend. Nested demos share the `/companies` parent. Question: can two parallel
runs race on creating `/companies` itself?

**Analysis (from `copy-folder.sh:187` mechanics):** the script never `mkdir`s a
container — it POSTs `destination=/org/repo/companies/<company>/…` and relies on
DA **implicitly** materializing the `companies/` prefix. In DA, folders are
implicit (a "folder" is the common path-prefix of its documents; there is no
folder object to create). So two runs writing `companies/workday/…` and
`companies/apple/…` write **disjoint documents that merely share a prefix** — the
same "no shared mutable node" property flat demos have, one level deeper. The
container appears when the first document from *either* writer lands, with no
coordination.

**Guards to add (cheap, correct regardless of DA's exact folder model):**
- Do **NOT** add an explicit container "create" step — implicit creation handles
  it and avoids inventing a shared write. Optionally one tolerant
  `list /org/repo/companies` (404 = not yet, fine).
- **Harden the verify/repair list target** (ties to C1): list exactly
  `companies/$COMPANY` and strip `companies/$COMPANY/`, **never** list
  `companies` — so a concurrent sibling's in-flight copy can never enter this
  demo's verification set. Under concurrency this is load-bearing, not cosmetic.
- **State is already isolated:** each demo's `.internal/onboarding-state.json`
  lives in its own git worktree, so no state-file contention (the worktree design
  already handles this).

**MUST-VERIFY against DA before implementing (do not assume):** does DA hold any
**real object** at a folder path — a `.props` / folder-config / index sheet at
`/companies` — that a second writer under the same parent could clobber? If YES,
the container needs a create-once-if-absent with **409-as-success** tolerance
(same pattern as Round-3 asset-upload 409 handling). If NO (folders are pure
path-prefixes), nothing beyond the list-target hardening is needed. Resolve this
with one DA API probe (`list /org/repo/companies` on a two-demo state and inspect
whether any container-level object exists) before writing C1/C8 code.

### C7 — Tests *(P1)*
- `tests/hooks/guard-da-publish.test.sh` — update expected `daFolder`/paths to
  `/companies/…`.
- New `scripts/locale-utils` unit tests for the two-segment base (the C3 risk).
- `copy-folder.sh` test (if any) — destination assertion.
- Asset tests that assert `basePath`/`DEMO_BASE_PATH` values (`enrich-assets.test.js`,
  `update-index-cards.test.js`, `category-plan.test.js`) — bump expected values.

---

## Interaction with round5

- C5 (single-source `daFolder`) and C2/C6 (stop hardcoding `/<companyKey>` in
  five files) are the **same de-hardcoding principle**. Ideally land round5's
  `capture-base` / state-driven approach first, then this change writes
  `/companies/<key>` in **one** place (`daFolder` + `DEMO_BASE_PATH` derivation),
  not scattered. **Recommend: do round5 de-hardcoding, then C1-C7 on top.**
- The `nav-404-loop` verify check (round5 T1/1b) directly covers the boundary-page
  risk this change introduces — reuse it to gate C3.

---

## Risk summary

| Item | Risk | Why |
|---|---|---|
| C3 browser parser | **HIGH** | Every localized link/redirect on a foldered demo; two-segment base is a real logic change, not a string swap |
| C1 copy dest | MED | Path build + verify/repair path-stripping must all move together |
| C4 guard | LOW | Already state-driven; only the copy-arg regex |
| C2/C6 value+docs | LOW | Mechanical, but many occurrences — easy to miss one |
| DAM/worker routes | NONE | Deliberately untouched (metadata-scoped / already parameterized) |

---

## Decisions (LOCKED)

1. **Container name:** `companies` → `/companies/<companyKey>/…`.
2. **Legacy support:** **Nested-only.** Single parser code path; no flat/nested
   dual branch. `getBasePrefix()` detects `/companies/<co>/<loc>/…` only. NOTE:
   this changes the base derivation for the current flat root demo (`frescopa`)
   and any open flat-layout PR — those must be re-run/re-pointed under
   `/companies/`, or the root showcase keeps `DEMO_BASE_PATH=''` (unchanged, no
   company segment) and only *new* demos go nested. Confirm the root showcase
   path stays `''` (it does — `companyBasePath()` returns `''` when empty, so the
   nested-only parser change only affects foldered demos, and the flat-root
   showcase is unaffected because it has no company segment at all).
3. **Const vs. flag:** single const `CONTAINER="companies"` in `copy-folder.sh`;
   no `--container` flag (YAGNI).
4. **Sequencing:** **round5 de-hardcoding first**, then C1-C7 on top — so
   `/companies/<key>` is written once (via `daFolder`/`DEMO_BASE_PATH`
   derivation), and the `nav-404-loop` verify check gates the C3 parser change.

---

## Confirmed-live anchors

- `copy-folder.sh:187` `dest="/$ORG/$REPO/$COMPANY/$1"`; `:259,:279` verify strip; `:49` reserved.
- `config.js:68-73` `companyBasePath()` = normalized `DEMO_BASE_PATH` (worker parameterized).
- `locale-utils.js:63-84` `getBasePrefix` (one-segment assumption); `:91-99`, `:135+`.
- `enrich-assets.js:427` `basePath:'/${customerKey}/en'`; `:540` `DEMO_BASE_PATH:'/${customerKey}'`; `:536` `DEMO_COMPANY` (stays).
- `assets/config.js:175` `damPath='/content/dam/${customerKey}'` (stays flat).
- `guard-da-publish.sh:109` reads `daFolder`; `:195-205` copy-arg regex.
- `invariants.md:42-45` I6 reserved keys.
