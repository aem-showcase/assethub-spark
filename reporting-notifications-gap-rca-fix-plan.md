# Minimal Gap/RCA/Fix — reports + notifications pages missed

## What already exists

- **`copy-folder.sh` already knows the copied set.** It copies only `en`, `config`, and `login.html`; `en` includes `reports/*` and `my-dam/*`. It recursively enumerates source files, recursively enumerates destination files, compares them path-by-path with exact extensions, repair-copies misses, and exits non-zero if any copied document is still absent.
- **`publish-page.js` already publishes one DA path safely.** It posts `preview` before `live`, uses the DA token retry path, and is already recognized by publish guards.
- **`verify.mjs` is already the Step 4g hard gate.** It is the right place to add a completion-blocking check, because the defect was not "unable to publish"; it was "declared complete without proving every copied customer-visible page was live."
- **Existing guards scope writes, not completeness.** `guard-da-publish.sh` prevents publishing outside `/companies/<companyKey>`, and `guard-live-publish-ceiling.sh` protects the landing-page card count. Neither proves copied reports/notifications/detail pages are live.

## Gap

The run had **copy completeness** but no **published-copied-content completeness** check.

Transcript evidence:

- `companies/calm-us/en/reports/report-hub`: DA source 200, `aem.live` 404.
- `companies/calm-us/en/my-dam/my-notifications`: DA source 200, `aem.live` 404.
- The same missed-publish pattern also affected report siblings and detail pages:
  `asset-activity`, `logins`, `searches`, `asset-details`, `collection-details`,
  `renditions`, `search-collections`.

The pages were copied; they were just never previewed/live-published before the demo was reported complete.

## RCA

1. **I7 is prose, not a gate.** The skill says publish every copied path, but nothing executable fails completion when a copied page is still 404.
2. **Step 4 used a hand-maintained publish list.** It published edited/core pages and landing assets, not the full copied set.
3. **Step 4g sampled successful surfaces.** Landing cards, access JSON, icons, and residue checks passed, but none checked unedited copied pages like reports and notifications.

## Bare-minimum fix

Do **not** add a new manifest format or a new end-to-end publish workflow.

Add one hard Step 4g check to existing `verify.mjs`:

```text
copied-html-live
```

### What the check does

1. Read `customer.daFolder` and `companyKey` from `.internal/onboarding-state.json`.
2. Use the same recursive DA listing logic already proven in `copy-folder.sh` to enumerate copied destination files under `/companies/<companyKey>`.
3. Filter to customer-visible publishable HTML pages:
   - include `*.html`
   - exclude `/drafts/`
   - exclude media files and non-HTML sheets
4. For each page, probe the corresponding branch content origin URL:

   ```text
   https://<branch>--assethub-spark--aem-showcase.aem.live/<path-without-.html>
   ```

   Treat EDS index convention correctly:
   - `.../en/index.html` may resolve as `.../en/`
   - do not count `.../en/index` 404 as failure if `.../en/` is 200
5. Fail if any copied publishable HTML page returns 404/non-2xx.

### Why this is enough

- It uses the copied destination tree as the source of truth, not a new hand-authored list.
- It blocks the exact defect shape: **DA source exists, but live page is 404**.
- It does not require inventing a new batch publisher; if the check fails, the operator can use the existing `publish-page.js --path <path> --publish` for the listed paths.
- It belongs in `verify.mjs` because the minimum requirement is a **hold** before completion, not a bigger orchestration system.

## Small doc change

Update Step 4g mandatory verification to include:

```sh
node .claude/skills/rebrand-portal/scripts/rebrand/verify.mjs \
  --preview <branch>.dev.frescopamedia.com \
  --company <companyKey> \
  --only copied-html-live
```

And state:

- Do not mark `published`, `landed-via-pr`, or the demo complete while `copied-html-live` fails.
- Fix failures with existing explicit publishes:

  ```sh
  node .claude/skills/rebrand-portal/scripts/assets/publish-page.js \
    --path companies/<companyKey>/en/reports/report-hub \
    --publish --org <org> --repo <repo>
  ```

## Minimum test

Add one test fixture for `verify.mjs copied-html-live`:

- mocked DA list returns:
  - `companies/acme/en/reports/report-hub.html`
  - `companies/acme/en/my-dam/my-notifications.html`
  - `companies/acme/en/index.html`
- mocked live probes return:
  - reports page: 404
  - notifications page: 404
  - index folder route: 200
- expected result: check fails and prints the two missing paths, while not falsely failing `index`.

## Acceptance criteria

- A demo cannot be reported complete if any copied non-draft HTML page under `/companies/<companyKey>` is not live.
- The specific Calm miss (`reports/report-hub` and `my-dam/my-notifications`) would have failed Step 4g before the first completion summary.
- No new manifest, batch-publish command, or parallel workflow is required for the hold.

