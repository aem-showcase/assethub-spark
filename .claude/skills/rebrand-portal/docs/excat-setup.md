# Set up Experience Catalyst (excat)

Do this once on your machine, before your first demo. Most of the time is
downloads.

The rebrand skill copies the real colours, fonts and logo from the customer's
website. To do that it needs two things: the **excat plugin**, and a
**Chromium browser** for it to drive.

## Before you start

- Node 20 or newer — check with `node -v`
- Claude Code 2.0.15 or newer, or GitHub Copilot CLI
- Access to the `Adobe-AEM-Foundation` GitHub org

## 1. Install the plugin

Follow excat's own instructions:

**<https://github.com/Adobe-AEM-Foundation/aem-experience-catalyst#cli-interface-setup-instructions>**

They have four steps: add your Bedrock token to `~/.claude/settings.json`,
clone their repo and run `npm run install:all`, add the marketplace, then
install the plugin. Do all four — the settings file on its own only *enables*
a plugin, it can't install one.

If the clone fails with `Authentication failed`, use SSH:

```bash
git clone git@github.com:Adobe-AEM-Foundation/aem-experience-catalyst.git
```

If it fails with `Repository not found` on both HTTPS and SSH, you don't have
access to the repo yet — ask for it, or ask a colleague to share their
marketplace folder.

## 2. Check it worked

```bash
node .claude/skills/rebrand-portal/scripts/rebrand/extract-brand.mjs --check
```

You want this:

```
OK — design extraction is ready.
  plugin:    /Users/you/.claude/plugins/cache/excat-marketplace/excat/2.1.6
  extractor: sub-agents/excat-block-design-expert/brand-extract.js
  browser:   145.0.7632.6
```

Run it before every demo. It takes a few seconds, and it's the difference
between finding a problem now and finding it twenty minutes in, after the
content is already copied.

If it prints something else, find the message below.

## If the check fails

### "the Chromium it drives is not on this machine"

Most common, and expected on a new machine — the browser is a separate
download, not part of the plugin. The check prints the exact command; it looks
like this:

```bash
cd <the plugin path the check printed>/hooks/import-validator && npx playwright install chromium
```

About 150 MB, once per machine. Run it from that folder so you get the browser
version the plugin expects.

### "Could not locate the excat plugin"

The plugin isn't installed. Go back to step 1.

If you installed it somewhere unusual, point at it directly:

```bash
export EXCAT_ROOT=/path/to/excat
```

### "its Playwright package is missing"

The plugin was installed before its dependencies were. Reinstall it using
excat's instructions in step 1.

## Notes

- Keep your Bedrock token in your home settings (`~/.claude/settings.json`).
  Never put it in this repo.
- One plugin install covers both Claude Code and Copilot CLI.
- Copilot CLI can install straight from the repo without cloning:
  `copilot plugin install <owner>/<repo>:resources/plugins/aem-excat-plugin/excat-marketplace/excat`
