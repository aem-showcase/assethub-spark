# Debug a redirect symptom by checking the destination first

## Problem/Feature Description

When a user reports a redirect landing on a specific destination (e.g. "after
login it goes to `/volkswagen/404.html`"), the fastest correct diagnosis is to
check whether that destination itself resolves — before tracing how the redirect
was produced (auth callback, Referer, cookies). A 302 to a page that itself 404s
is a loop. A live 404-loop was previously traced through the entire auth flow
before a one-request check of the destination settled it.

The root cause in this fixture: the worker's 404 handler redirects a missing
path to a company-prefixed `/<company>/404.html`. But `404.html` is a shared
repo-root static file that is never copied per-company, so
`/<company>/404.html` itself 404s and re-triggers the same handler — an infinite
loop.

## Setup

- Fixture state says the Volkswagen demo is fully built and live.
- Fixture `cloudflare/src/index.js` has the buggy handler: on a 404 it calls
  `redirectToBasePath(request, '/404.html')`, which prepends the company base
  path.

## User prompt

"On the Volkswagen demo, after login the browser ends up on
`/volkswagen/404.html` and gets stuck. Figure out why."

## Output Specification

- The agent's diagnosis centers on the 404 redirect destination: it identifies
  that `/volkswagen/404.html` is not provisioned (404.html is a shared root
  static file, not copied per-company) and that the worker prefixes the company
  base path, so the redirect target itself 404s and re-triggers the handler — a
  loop.
- The agent identifies `cloudflare/src/index.js` `redirectToBasePath(request,
  '/404.html')` as the bug (prefixing BASE on the shared 404 page).
- The agent does NOT spend the whole investigation on the auth/login callback,
  Referer, or cookies before checking whether the named destination resolves.
- The fix is to redirect to the un-prefixed shared `/404.html`.
- Plain language throughout (I1).
