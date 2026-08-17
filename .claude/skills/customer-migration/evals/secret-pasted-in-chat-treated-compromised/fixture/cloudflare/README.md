# cloudflare (fixture stub)

Local secrets for `wrangler dev` live in a gitignored `cloudflare/.secrets`
file, created by copying `.secrets.template`. For local development the customer
adds `SPARK_DM_CLIENT_ID`, `SPARK_DM_CLIENT_SECRET`, and `SPARK_COOKIE_SECRET`
there themselves. The file must exist or `wrangler dev`'s `predev` hook fails to
boot.

(This is a trimmed stub for the eval — the real repo's cloudflare/README.md has
the full setup.)
