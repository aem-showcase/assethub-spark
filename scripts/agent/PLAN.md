# Asset Enrichment Plan

## Outcome

- Customer assets are uploaded into `/content/dam/<customerKey>`.
- Assets get enough metadata to show in search, facets, homepage cards, and collections.
- Metadata writes are add-only from the agent's perspective.
- Existing metadata is preserved.
- Category cards are backed by real non-zero asset coverage.

## Inputs

- `customerKey`
- optional `sourceUrl`
- optional `damPath`, constrained under `/content/dam/<customerKey>`
- existing credentials:
  - `SPARK_DM_CLIENT_ID`
  - `SPARK_DM_CLIENT_SECRET`
- AEM environment id from `cloudflare/src/config.js`

## Flow

1. Resolve credentials and mint an IMS bearer token.
2. If `sourceUrl` is present:
   - scrape source-site image/document candidates
   - download usable assets
   - upload through the AEM repository upload flow
   - enumerate the target folder to resolve actual DAM repo paths and asset ids
3. If `sourceUrl` is absent:
   - enumerate existing assets under `/content/dam/<customerKey>`
4. For each asset:
   - read Sling metadata from `<repoPath>/jcr:content/metadata.json`
   - skip if already enriched for this customer
   - generate candidate title, description, keywords, campaign, channel, brand
   - assign `productCategory` from existing metadata and source-site evidence
   - build a Sling form update for missing fields only
   - POST the form to `<repoPath>/jcr:content/metadata`
   - re-read metadata and verify required fields
5. Write a report with counts, category coverage, unclassified assets, and representative assets.

## Upload API

Uploads mirror the AEM Assets UI repository flow:

```text
POST /adobe/repository/...;api=create
POST /adobe/repository/...;api=block_upload
PUT <presigned blob URL>
POST /adobe/repository/...;api=block_upload_finalize
```

The upload response is not trusted as the final file asset id in every environment.
After upload, the controller enumerates the folder and resolves each uploaded asset by
`repoPath` / `repoName`.

## Metadata API

Metadata uses Sling on the DAM repo path:

```http
GET /content/dam/<customerKey>/<asset>/jcr:content/metadata.json
Authorization: Bearer <ims-token>
```

```http
POST /content/dam/<customerKey>/<asset>/jcr:content/metadata
Authorization: Bearer <ims-token>
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
```

No metadata `x-api-key` is used. No Assets Author metadata PATCH is used.

## Metadata Fields

- `dc:title`
- `dc:description`
- `dc:subject`
- `productCategory`
- `campaign`
- `channel`
- `brand`
- `company`
- `dam:status`
- `allowedCountries`

## No-Overwrite Rules

- Scalar fields are sent only when missing.
- `company` conflicts if present with a different value.
- `dam:status` conflicts if present and not `approved`.
- Missing multi-value fields are created with `@TypeHint=String[]`.
- Existing multi-value fields are appended with `@Patch=true` and `+value`.
- Existing scalar multi-value targets are kept; required values that cannot be appended are reported as conflicts.

## Category Rules

- Existing `productCategory` wins.
- Otherwise derive from:
  - source page URL
  - page title
  - heading
  - alt text
  - nearby text
  - filename
  - generated keywords
- If no category is defensible, do not write `productCategory`.
- Category coverage is computed from written or already-existing categories.

## Removed

- CSV metadata import.
- Assets Author metadata PATCH.
- JSON Patch metadata plans.
- ETag retry logic for metadata.
- `AUTHOR_SPARK_IMS_TOKEN`.
- Strict operator-supplied category/channel vocab flags.

## Verification

- Unit tests cover Sling form generation, no-overwrite behavior, and controller writes.
- Live smoke test uploads sample assets, writes metadata through Sling, and verifies readback:
  - `company=<customerKey>`
  - `productCategory`
  - `dam:status=approved`
  - `allowedCountries` includes `global`
