# Assets Hub Spark

> [!WARNING]
> This is currently a demo and not an officially supported Adobe solution.


Assets Hub Spark is an experimental demo asset-sharing portal built on AEM Edge Delivery Services (Helix) & Content Hub (Dynamic Media) APIs.

## Environments

### Main site (cloudflare worker):
- Live: https://frescopamedia.com
- Preview: https://preview.frescopamedia.com
- Branch (preview): <https://{branch}.dev.frescopamedia.com>
- Branch (live): <https://{branch}-live.dev.frescopamedia.com>

Note: For branch URLs to work, the branch names must be short and only include lowercase letters, numbers, and dashes characters. Due to [cloudflare worker alias limitations](https://developers.cloudflare.com/workers/configuration/previews/#rules-and-limitations).

### Helix origins
- Live: https://main--assethub-spark--aem-showcase.aem.live
- Preview: https://main--assethub-spark--aem-showcase.aem.page

## Project structure

This project is based on the [aem-boilerplate](https://github.com/adobe/aem-boilerplate) template and adds both React components and a Cloudflare worker.

List of projects, each with their own `package.json`:
- root - the AEM EDS main project
- [cloudflare](cloudflare): Cloudflare worker for the assets share portal

### AEM EDS

Before using the aem-boilerplate, we recommand you to go through the documentation on https://www.aem.live/docs/ and more specifically:

1. [Developer Tutorial](https://www.aem.live/developer/tutorial)
2. [The Anatomy of a Project](https://www.aem.live/developer/anatomy-of-a-project)
3. [Web Performance](https://www.aem.live/developer/keeping-it-100)
4. [Markup, Sections, Blocks, and Auto Blocking](https://www.aem.live/developer/markup-sections-blocks)

### Asset Search Block

The asset search functionality is implemented as a vanilla JS EDS block in `blocks/search-results/`.

### Hero Collage Block

`blocks/hero-collage/` is copied from the Heineken portal's `heineken-landing`
branch. Author a **Hero Collage** table with up to four image cells in the first
row, followed by a row containing the headline and optional eyebrow/supporting
copy. Empty image cells and unavailable DM images display "Preview not found"
with the portal's standard pink error background and red text instead of a star;
panel dimensions and positions are retained.
The collage uses four image panels on desktop, three on tablet, and the brand
headline panel only on mobile. Spark supplies fallback theme values without
changing global styling, and its default hero auto-blocking leaves the collage's
headline and pictures in place.

### DA-authored Dynamic Media images

The repo-hosted DA library plugin at `tools/asset-selector.html` reuses Adobe's
Asset Selector UI. Authors select an asset from **Library > DM Asset Selector**.
The plugin inserts a complete DM link using the DA App SDK; it does not depend
on the native picker's `aem.repositoryId` or `aem.assets.image.type` settings.
DA stores and displays a link, not an inline image preview.

The plugin and website renderer share the delivery origin exported by
`scripts/dm-images.js`. The selector browses the delivery repository using the
author's in-memory DA SDK IMS token. No tokens or service-account credentials
are written to the document, configuration, or browser storage. Keep
`ADOBE_PROVIDED_CLIENT_ID=darkalley` in Cloud Manager for this DA-authenticated
integration; removing the native picker settings does not remove that requirement.

Register the plugin in the site's DA configuration **`library`** tab:

| title | path | ref | experience |
|-------|------|-----|------------|
| DM Asset Selector | `/tools/asset-selector.html?v=20261102-selector-label` | `asset-selector` | `fullsize-dialog` |

`fullsize-dialog` uses DA's viewport-sized popup instead of its 600px dialog.

This development-only entry is visible for the `asset-selector` editor ref or
`ref=local`, not the default editor. For local development, run the EDS server
on port 3000 and open:

`https://da.live/edit?ref=local#/aem-showcase/assethub-spark/en/drafts/tphan/index`

Open **Library > DM Asset Selector**, select one asset, and click **Select**.
The library closes after sending the reference to the document. Initialization,
authentication, and invalid-selection errors are shown in the plugin with a
reload action; insertion is handled and saved by DA.

After deploying the plugin to `main`, change the library row's `ref` to `main`
or leave it empty to enable it for normal authors. Save DA configuration and
reload the editor after changing it; the configuration itself does not need
previewing or publishing. Do not register an unpushed branch as a production tool.

Images use the web rendition (`.avif`), videos use the player (`/play`), and
other asset types use their original delivery URL. This matches the native
picker's default link-insertion behavior; only image references are rendered
as images by the website.

On the website, `scripts/dm-images.js` converts DM image links in single-link
paragraphs and block cells into
`picture` elements before section and block decoration. This works in default content,
carousels, cards, and fragments. The browser requests `/api/adobe/assets/...` on the
current portal origin, so preview, live, and branch sites use their own Cloudflare
session and the existing server-side DM authentication. Image modifiers in the
reference's query string are preserved; no credentials are stored in the document.
Image detection and delivery use the link's URL (`href`), not its display text.
Different or truncated labels do not prevent rendering, and adjacent text is
preserved. URL-shaped titles and labels are not used as image alt text.

Only image references from the configured Spark delivery environment are converted.
PDFs, videos, non-image navigation links, other delivery environments, and existing
Media Bus images are left unchanged. If the backing DM environment changes, update
the delivery origin in `scripts/dm-images.js` and `cloudflare/src/config.js`.
The custom selector derives its repository from that origin.
Add meaningful link title/text to supply image alt
text; a bare URL produces empty alt text.

Run the site through the Cloudflare portal, not directly on the protected
`aem.page`/`aem.live` origin: those EDS origins do not provide the `/api` proxy.
The proxy preserves its existing access rules; this feature does not change asset
approval targets or grant viewers additional permissions. Re-preview the document
after authoring and publish it when ready. With link insertion, no
`html2md.externalImageUrlPrefixes` feature is required.

### Cloudflare Worker

A Cloudflare Worker is located in the [cloudflare](cloudflare) folder. This worker handles the site and sits in front of AEM Helix and Dynamic Media.

## Rebrand portal skill

To produce a branded demo of the portal for a company, see [docs/rebrand-guide.md](docs/rebrand-guide.md).

## Installation

Install npm dependencies for the root project and cloudflare worker:

```sh
npm install
```

This automatically installs cloudflare worker dependencies via the `postinstall` script.
The nested install clears npm's exported `allow-scripts` environment variable so
npm 11 re-reads script permissions from its configuration files rather than
rejecting the inherited value as a project-scoped CLI policy. It does not disable
script policy or change your user-level npm configuration.

### Cleanup

To cleanup the checkout (remove all `node_modules`, build and cache folders etc.) run this first in the root:

```sh
npm run clean
```

## Local development

### Initial setup

Add `cloudflare/.secrets` file with the [required secrets](cloudflare/README.md#secret-store), such as:

```
# Cookie authentication
# For local development, not the same as production. generate using `openssl rand -base64 32`
SPARK_COOKIE_SECRET="..."

# DM IMS technical account token
# Get from Adobe developer console project with access to AEM_ENV_ID delivery environment
SPARK_DM_CLIENT_ID="..."
SPARK_DM_CLIENT_SECRET="..."
```

### Run full stack locally

```sh
npm start
```

This should open <http://localhost:8787> in your browser. Use `Ctrl+C` to stop it.

This runs a local cloudflare worker (`wrangler dev`) and local EDS (`aem up`).

#### Running multiple instances

You can run multiple `npm start` instances simultaneously (e.g. from different git worktrees). The script auto-detects free ports when the defaults are taken:

| Service | Default | Fallback sequence |
|---------|---------|-------------------|
| AEM (`aem up`) | 3000 | 3001, 3002, 3003, ... |
| Wrangler | 8787 | 9001, 9002, 9003, ... |
| Inspector | 9229 | 9301, 9302, 9303, ... |

The resolved ports are printed at startup. When a worktree is created, the `.secrets` file is copied from the main checkout (see below).

#### Git worktrees

Files that are git-ignored but needed in every worktree (`cloudflare/.secrets`, `token.env`) are copied as real files from the main checkout when a worktree is created, so each worktree owns independent secrets and parallel demos never share or clobber a token:

- `claude -w <name>` (Claude Code) creates the worktree in `.claude/worktrees/<name>` on a branch named `<name>` (no `worktree-` prefix) via `.claude/hooks/worktree-create.js`, and removes both again on exit via `.claude/hooks/worktree-remove.js`.
- Plain `git worktree add` (or other tools) is covered by the `.husky/post-checkout` hook, which does the same copy.

Dependencies are installed automatically by `npm start` when `node_modules` is missing.

Note you will need to stop and restart `npm start` after 24 hours to renew the DM IMS technical account token.

Environment variables supported by `npm start`:

| Variable | Description | Default |
|----------|-------------|---------|
| `AEM_PAGES_URL` | EDS content URL | https://main--assethub-spark--aem-showcase.aem.page |
| `AEM_ENV_ID` | AEM Program + Environment ID | p203220-e2129061 |
| `DEV_BROWSER` | Browser to open. Mac OS only.<br><br>Options:<ul><li>`Google Chrome`</li><li>`Safari`</li><li>`Firefox`</li></ul> | - (system default) |
| `AEM_LOG_LEVEL` | Set [`aem` log level](https://www.aem.live/developer/cli-reference#general-options). | `info` |
| `CLOUDFLARE_LOG_LEVEL` | Set [wrangler dev --log-level](https://developers.cloudflare.com/workers/wrangler/commands/#dev). Maps to `console.<level>()` in js. <br><br>From most to least verbose: <ul><li>`debug` (avoid, very noisy with internals)</li><li>`log`</li><li>`info`</li><li>`warn`</li><li>`error`</li><li>`none`</li></ul> | `info`<br><br> This hides `console.log` output, but works well if you treat `console.log` as "debug" level that should be hidden by default from local output. Then use `console.info` for your test logs you want to see immediately.  |
| `CLOUDFLARE_REQUEST_LOGS` | Set to `1` to show request logs from cloudflare worker, which is the default behavior of `wrangler dev` but we turn it off to keep things readable.<br><br> Example request log:<br>`[wrangler:info] GET /path 200 OK (10ms)` | - (off) |

### Troubleshooting: Ports still open

If after quitting `npm start` the ports on localhost are still in use because processes are left behind, run this:

1. List processes from this script:
   ```sh
   ps x | grep -vF grep | grep -E "(run.sh|wrangler|chokidar|aem up)"
   ```

2. Kill these processes:
   ```sh
   ps x | grep -vF grep | grep -E "(run.sh|wrangler|chokidar|aem up)" | awk '{print $1}' | xargs kill
   ```

## Local Notes Directory

The `.internal/` directory is git-ignored and available for engineers to keep local context notes, scratch files, planning docs, or any other private files that shouldn't be committed. Create this directory as needed:

```sh
mkdir .internal
```

## Linting

Should work in each project folder:

```sh
npm run lint
```

## Testing

Should work locally from root and cloudflare folder:

```sh
npm run test
```

Test will also run during PR builds.


## SonarQube

SonarQube analysis is configured in [sonar-project.properties](sonar-project.properties).
Project on Hosted instance can be found at https://aem-assets.cq.corp.adobe.com/dashboard?id=spark

To run full project analysis and update hosted report, run from root:

Requires sonar token in env  
export SONAR_TOKEN=your_token

```sh
npm run sonar
```
To run full branch analysis and update hosted branch report, run from root.
This will automatically detect the current branch name and compare against main and show only new issues introduced in the branch.

```sh
npm run sonar:branch
```

## CI/CD

[Github actions](.github/workflows/) build & lint the project, and automatically [deploy the cloudflare worker](cloudflare/README.md#deploying). They also automatically rotate secrets (running on a cron schedule).

Github actions must be configured with these [secrets](cloudflare/README.md#ci-secrets) and [variables](cloudflare/README.md#ci-variables).
