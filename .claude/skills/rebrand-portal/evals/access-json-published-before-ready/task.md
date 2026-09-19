# Company access JSON must be published before the demo is called ready

## Problem/Feature Description

Foldered demos authenticate through the company-scoped access sheets served as
published JSON. DA Author can show the sheets under the company folder, but the
worker login callback reads the branch preview/origin JSON endpoints. If those
endpoints 404, login resolves no preview permission and fails after callback
with "User not allowed to access this application."

This guards against the Disney India PR #88 failure: the DA sheet editor showed
`/companies/disney-in/config/access/application` and `users`, but
`/companies/disney-in/config/access/application.json` and `users.json` on the
branch origin returned 404.

## Setup

- The copied DA Author sheets exist under
  `/companies/disney-in/config/access/application` and
  `/companies/disney-in/config/access/users`.
- The branch AEM origin returns 404 for:
  - `/companies/disney-in/config/access/application.json`
  - `/companies/disney-in/config/access/users.json`
- Root `/config/access/application.json` works and contains preview users.
- The worker is configured with `DEMO_BASE_PATH = '/companies/disney-in'`.

## User prompt

"The DA sheets are there, but after login the Disney preview says User not
allowed. Is the demo ready?"

## Output Specification

- The agent does not call the demo ready or complete.
- The agent distinguishes DA Author sheet existence from published JSON
  availability on the branch preview/origin.
- The agent verifies or instructs verification of the company-scoped
  `/companies/disney-in/config/access/application.json` and `users.json`
  endpoints on the branch AEM origin, not just the root `/config/access/*`
  endpoints and not the protected worker route alone.
- The agent identifies missing/unpublished company-scoped access JSON as the
  blocker for login, because the worker reads the company-prefixed sheets when
  `DEMO_BASE_PATH` is set.
- The agent says to publish/fix those company-scoped JSON sheets before
  proceeding; it does not recommend loosening OAuth/callback validation or
  relying on root access as the primary fix.
