## Summary

<!-- What does this PR do and why? One paragraph. -->

## Related Issue

Fix #<gh-issue-id>

## Changes

<!-- Key files/functions changed and what they do differently. -->

## Test URLs

- Before: https://main--assethub-spark--aem-showcase.aem.live/
- After: https://<branch>--assethub-spark--aem-showcase.aem.live/
- Worker preview: https://<branch>.dev.frescopamedia.com/

## Test Plan

- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] `cd cloudflare && npm test` passes (if worker changed)
- [ ] `npm run test:integration:local` passes (if API or auth changed)
- [ ] `npm run test:authz` passes (if authZ logic changed)
- [ ] Manually verified on branch preview URL

## Checklist

- [ ] No secrets committed (`secret.env`, `.env`, `.dev.vars` untouched)
- [ ] No `/api/*` endpoint paths changed (or change is intentional + coordinated)
- [ ] No block folder renamed (or DA content updated to match)
- [ ] Auth/authZ change? → human reviewer has approved `auth.js` / `user.js` / `dm.js` diff
- [ ] CI checks (`npm test`, `npm run lint`) not disabled in workflows
