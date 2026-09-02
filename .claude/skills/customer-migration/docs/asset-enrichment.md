# Asset Enrichment

This tool prepares a customer demo's AEM assets so they show up in the portal search,
filters, category cards, and collections.

It can work in two ways:

- Use assets already in `/content/dam/<customerKey>`.
- Pull assets from a customer website first, upload them to AEM, then enrich them.

## What It Adds

For each asset, the tool fills missing metadata only:

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

Existing metadata is kept. The tool does not replace titles, categories, descriptions,
or customer-authored values already on the asset.

## Why Category Matters

`productCategory` powers the Category filter and the homepage category cards.

Example:

```text
/search?facetFilters={"productCategory":{"products":true}}
```

That link only works when at least one visible asset has:

```text
productCategory = products
company = <customerKey>
dam:status = approved
allowedCountries contains global
```

The tool builds category coverage from the assets it actually found. Category cards
should use that coverage report, so a card does not link to a bucket with zero assets.

## How Categories Are Chosen

Category assignment uses evidence in this order:

- existing `productCategory`
- category or section discovered from the source site
- source page URL
- page title and headings
- image alt text
- nearby/source text when available
- filename and generated keywords as fallback evidence

There is no hardcoded Audi list and no operator-supplied strict category vocabulary.
If the tool cannot defend a category for an asset, it does not write `productCategory`
for that asset and reports a category failure.

## Command

```bash
node .claude/skills/customer-migration/scripts/assets/enrich-assets.js \
  --customer-key <customerKey> \
  [--dam-path /content/dam/<customerKey>] \
  [--source-url <url>] \
  [--dry-run] [--force] \
  [--concurrency <n>] \
  [--limit <n>] \
  [--secrets-file cloudflare/.secrets] \
  [--aem-env-id pNNN-eNNN] \
  [--metadata-mode filename|vision] \
  [--report-file <path.json>]
```

Examples:

```bash
node .claude/skills/customer-migration/scripts/assets/enrich-assets.js \
  --customer-key acme \
  --dry-run \
  --report-file .internal/acme-assets-report.json
```

```bash
node .claude/skills/customer-migration/scripts/assets/enrich-assets.js \
  --customer-key acme \
  --source-url https://www.acme.example/products \
  --report-file .internal/acme-assets-report.json
```

## Credentials

The tool reads existing Dynamic Media credentials:

- `SPARK_DM_CLIENT_ID`
- `SPARK_DM_CLIENT_SECRET`

Credential lookup order:

- environment variables
- `cloudflare/.secrets`
- `secret.env`

The tool does not use `AUTHOR_SPARK_IMS_TOKEN`.

## AEM APIs Used

Source-site uploads use the same repository upload flow as the AEM Assets UI:

```text
POST /adobe/repository/...;api=create
POST /adobe/repository/...;api=block_upload
PUT <presigned blob URL>
POST /adobe/repository/...;api=block_upload_finalize
```

Metadata reads and writes use Sling on the asset metadata node:

```http
GET /content/dam/<customerKey>/<asset>/jcr:content/metadata.json
POST /content/dam/<customerKey>/<asset>/jcr:content/metadata
```

The metadata POST uses a normal Sling form body:

```text
./productCategory=products
./company=acme
./dam:status=approved
./allowedCountries@TypeHint=String[]
./allowedCountries=global
```

The form is built after reading current metadata. Scalar fields are sent only when
missing. Multi-value fields use Sling's append mode when the asset already has values,
so existing keywords and country values are kept.

## Report

Use `--report-file` to write a JSON report.

Important fields:

- `counts`: enriched, skipped, and failed asset counts
- `assets`: per-asset outcome and failure reason
- `categoryCoverage.categories`: categories that have at least one asset
- `categoryCoverage.unclassified`: assets with no defensible category
- `representatives.items`: one usable asset per category for card imagery

Example:

```json
{
  "counts": { "enriched": 12, "skipped": 3 },
  "categoryCoverage": {
    "categories": [
      {
        "slug": "products",
        "label": "Products",
        "assetCount": 12
      }
    ],
    "unclassified": []
  },
  "representatives": {
    "items": {
      "products": {
        "productCategory": "products",
        "assetId": "urn:aaid:aem:...",
        "assetPath": "/content/dam/acme/hero.jpg",
        "title": "Hero"
      }
    }
  }
}
```

## Not Used

- CSV metadata import
- `--write-mode`
- `AUTHOR_SPARK_IMS_TOKEN`
- Assets Author metadata PATCH / JSON Patch
- strict `productCategory` or `channel` vocabulary flags

## Tests

```bash
npx vitest run .claude/skills/customer-migration/tests/assets
```
