# Welcome-header home icon/link must not stay hardcoded to the base brand

## Problem/Feature Description

`blocks/header/header.js`'s minimal welcome-page header (the
`getMetadata('header') === 'no'` path, used on login/welcome-style pages)
renders a raw template literal that historically hardcoded the base
brand's icon class, icon file, and home link:

```js
<a href="/" class="welcome-logo" aria-label="Home">
  <span class="icon icon-frescopa-icon">
    <img src="/icons/frescopa-icon.svg" alt="Fréscopa" loading="eager" />
  </span>
</a>
```

Step 4's rebrand touches `blocks/header/header.css` and DA-doc icon
shortcodes, but never this file — so it ships live with two defects: (1)
`icon-frescopa-icon`/`frescopa-icon.svg` reference the base brand's icon,
which 404s once Step 4 renames the icon file to `<companyKey>-icon.svg`,
leaving no visible way home; (2) `href="/"` is a bare literal never run
through `localizePath()` (every other link in this file uses it), so even
if the icon rendered, clicking it would not resolve to the company's home
on a foldered `/companies/<company>/<locale>/...` demo.

## Setup

- Fixture state says Samsung's copy is rebranded, published, and landed;
  asset steps are pending.
- Fixture `blocks/header/header.js` carries the REGRESSED welcome-header
  block: hardcoded `icon-frescopa-icon` class, `frescopa-icon.svg` src,
  and a bare `href="/"`.
- Fixture `icons/samsung-icon.svg` exists (the correctly-renamed brand
  icon) — `icons/frescopa-icon.svg` does NOT exist, matching the real
  live scenario where Step 4 renamed rather than duplicated the file.

## User prompt

"Run the welcome-header home link/icon check for the Samsung demo before we move on to assets."

## Output Specification

- The agent reads the actual `blocks/header/header.js` welcome-header
  block and identifies both defects: the hardcoded base-brand icon
  class/file, and the bare `href="/"` not run through `localizePath()`.
- The agent does NOT claim the welcome-header path already handles this
  correctly, or that it's out of scope because "Step 4 only touches CSS."
- The agent fixes `header.js` so the welcome-header home link resolves via
  `localizePath('/')` and no longer references the base brand's icon
  class/file — reusing the company's real icon (e.g. from the `.nav-brand`
  fragment already loaded elsewhere in this file, or the captured
  `<companyKey>-icon.svg`), not inventing a second hardcoded literal.
- The agent does not treat the welcome-header check as passing while
  either defect is present.
- Plain language throughout (I1).
