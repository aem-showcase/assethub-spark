# Experience Catalyst (excat) — operator setup

**Audience: the human running the demo.** Agent-facing rules for design
matching live in `step-4-rebrand.md`; brand-provenance policy lives in
`invariants.md` (I10). Nothing in this file is customer-facing.

This is machine setup. Do not put machine-specific paths, Bedrock tokens, or
generated settings into the project repo.

## What design matching actually needs

Two things, and they fail for different reasons:

| # | Thing | Comes from | Lives |
|---|---|---|---|
| 1 | the brand extractor (`brand-extract.js`) | the excat plugin | inside the plugin |
| 2 | a Chromium that can run it | `playwright install` | a **machine-global** cache (`~/Library/Caches/ms-playwright`), **not** inside the plugin |

Installing the plugin normally delivers both, because installing its
dependencies triggers Playwright's browser download. They come apart when a
plugin install is copied between machines, or when the browser cache is
cleaned — leaving (1) present and (2) missing.

A plugin can also be **live** — loaded straight from a local marketplace
directory and never copied into a cache. Copilot CLI shows these as
"Live Plugins"; `--check` below finds both shapes.

## Verify — one command

```bash
node .claude/skills/rebrand-portal/scripts/rebrand/extract-brand.mjs --check
```

```
OK — design extraction is ready.
  plugin:    /Users/you/.claude/plugins/cache/excat-marketplace/excat/2.1.6
  extractor: sub-agents/excat-block-design-expert/brand-extract.js
  browser:   145.0.7632.6
```

Exit 0 means ready. Exit 3 prints the fix. Run it **before** starting a demo —
it takes seconds, and the alternative is discovering the problem ~20 minutes
in, after the content copy and branch work are already done.

> Do not substitute `claude plugin list` or a file-existence check such as
> `ls .../node_modules/playwright/index.mjs`. The first reports only that a
> skill is *loadable*; the second passes on a machine with **no browser at
> all**. Both return green on exactly the machine that fails. `--check`
> launches the browser, so it cannot false-green.

## If `--check` fails

### "Could not locate the excat plugin"

You don't have the plugin. Install it with **excat's own instructions** —
maintained by that project, so they stay current as it changes:

**<https://github.com/Adobe-AEM-Foundation/aem-experience-catalyst#cli-interface-setup-instructions>**

Their four steps, in order:

1. Install Claude Code (Node 20+), and create `~/.claude/settings.json` with
   your Bedrock token and `"enabledPlugins": { "excat@excat-marketplace": true }`.
2. Clone the repo, then `npm run install:all` inside
   `resources/plugins/aem-excat-plugin/excat-marketplace`.
3. `/plugin marketplace add /absolute/path/to/.../excat-marketplace`
4. `/plugin install excat@excat-marketplace`

Two things worth knowing before you start:

- **Step 1 alone is not enough.** `enabledPlugins` only *enables* a plugin
  that is already installed; it cannot install one. Steps 2–4 are required.
- **Step 2 is excat's, not ours.** Their marketplace is a local directory of
  source whose `node_modules` are gitignored, so a fresh clone has none and
  `install:all` is what supplies them — including the Chromium download. We
  deliberately do not reproduce those commands here: a copy would drift from
  the original, and a stale copy of someone else's install procedure is worse
  than a link to the current one.

If the clone fails with `Authentication failed` over HTTPS, use SSH instead:

```bash
git clone git@github.com:Adobe-AEM-Foundation/aem-experience-catalyst.git
```

(or configure the HTTPS credential helper with `gh auth login`; excat's README
also notes `gh auth switch` if you need a different account).

If it fails with `Repository not found` over **both** HTTPS and SSH, that is
an access problem, not an auth-method problem — request access, or ask a
colleague for the marketplace directory (excat's README covers sharing under
*Distribution*). Copilot CLI can also install a plugin straight from a repo
subdirectory without any clone:

```bash
copilot plugin install <owner>/<repo>:resources/plugins/aem-excat-plugin/excat-marketplace/excat
```

which works as soon as the repo is readable by your account.

**If you already have the plugin, none of this applies to you.**

Non-standard install location? `export EXCAT_ROOT=/path/to/excat`.

### "the Chromium it drives is not on this machine"

The plugin is fine; only the browser is missing. `--check` prints the exact
command, resolved against your installed version:

```bash
cd <path --check printed>/hooks/import-validator && npx playwright install chromium
```

Roughly 150 MB, once per machine. Run from that directory so it uses the
Playwright version the plugin pins, and therefore installs the matching
browser build.

### "its Playwright package is missing"

The plugin was installed from a source tree whose dependencies were never
installed. Reinstall it per excat's instructions above.

## During a demo run

**There is never a `git clone` and never an `npm install` while a demo is
running.** If either appears necessary mid-run, the plugin is not installed —
fix that, then resume. Setup-time and run-time are different, and only
setup-time involves npm.

## Prerequisites

- Node 20 or newer.
- A host that loads the plugin — Claude Code 2.0.15+ or GitHub Copilot CLI.
  Plugin *management* commands (`/plugin list`, `/plugin install`) are
  Claude Code's; Copilot CLI resolves an already-installed plugin from the
  same on-disk cache, so one install serves both.
- If the environment uses AWS Bedrock, configure credentials only in your
  user-home settings. Do not add Bedrock tokens to this repo.
