# DA credential injection (agent note, not customer-facing)

Some hosts running this skill — e.g. the `aemcoder.adobe.io` chat UI — inject
the DA/hlx credential **at the network layer**, gated by a permission toggle in
the host's own Settings panel (worded roughly: "Allow LLM to use my Adobe
credentials for admin.hlx.page, Document Authoring..."). In that environment,
`token.env`'s `DA_TOKEN` value is never actually read by `admin.da.live`/
`admin.hlx.page` — the host substitutes the real credential on the wire before
the request leaves, regardless of what `Authorization` header the packaged
scripts send.

**Never assume a file-based token is the only path — probe before asking the
customer for one.**

## The probe

Before running the `token.env` walkthrough (`docs/rebrand-guide.md#token-setup`),
send one authenticated GET to a real DA endpoint for this session's org/repo,
using an obviously-placeholder bearer value:

```
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer probe" \
  "https://admin.da.live/list/{org}/{repo}"
```

- **`200`** → DA-tier credential injection is active for this session. Do
  **not** ask the customer for a real `DA_TOKEN`. Ensure `token.env` still
  contains a non-empty placeholder value (the packaged scripts only check for
  presence, not correctness — real auth already happened at the network
  layer). Tell the customer once, plainly: DA/content credentials are already
  active for this session, nothing further needed from them for content
  access. Proceed straight to Step 3/Step 4a's token-dependent work.
- **`401`/`403`** → no injection present; fall back to the normal
  `docs/rebrand-guide.md#token-setup` walkthrough as today.

## Scope

This probe and its result apply **only** to the DA/hlx tier
(`admin.da.live`, `admin.hlx.page`). It says nothing about GitHub push/PR
credentials or Dynamic-Media/asset-enrichment credentials — those follow
their existing, unrelated paths and are out of scope here.
