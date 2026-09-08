# rebrand-portal — live-run fixes plan

Source: transcript `2026-09-05-182817-i-want-new-portal-for-httpswwwhyundaicomin.txt`
(Hyundai India demo run, Opus 5, 35 min to Step 4 completion)

Four bugs surfaced. Items numbered to match the agreed list (4 = favicon.svg, dropped).

---

## 1. excat check moved to entry (before Step 3)

**What happened:** Agent detected excat was installed-but-disabled mid-Step 4 preflight.
The user had already done the DA setup (Step 3, token.env). Restart was needed, but the
work done to that point (state file, DA copy) was valid and resumable. The interrupt was
less disruptive than it could be — but the user still had to restart mid-flow.

**Change:** Move the excat availability check to the Entry flow, between state load and
Step 3. If not invokable at entry: surface the three states (invokable / installed-not-enabled
/ not-installed), tell the operator what to do, and say "tell me when it's ready — Steps 1–3
don't need it and I'll run those now while you sort it." Don't block Steps 1–3; do block
Step 4 as before.

**Files to edit:**
- `SKILL.md` — Entry flow section: add excat check as step 0.5 (after state load, before
  running the sequence). One short paragraph; keep it terse.
- `docs/excat-setup.md` — no change needed; SKILL.md already references it.

---

## 2. `da-content-copied` only marked done after verification exits 0

**What happened:** At the transcript's interrupted point, `da-content-copied` was written
as `done` in state before the verification loop confirmed exit 0. If the session had ended
there, a resume would have skipped re-verification of a step that wasn't fully confirmed.

**Change:** Add one explicit rule to step-3-da-copy.md: do not write `da-content-copied: done`
until the script exits `0` and the path-by-path verification passes. The state write must
be the last action in the step, not an optimistic pre-mark.

**Files to edit:**
- `docs/step-3-da-copy.md` — add under Exit codes section: "Write `da-content-copied: done`
  only after exit `0` is confirmed and path-by-path verification passes. Do not pre-mark
  `done` before the verification loop completes."

---

## 3. Content-residue check must reject non-200 responses

**What happened:** Agent's residue sweep was calling `curl` on published paths and checking
response bodies for old-brand strings — but passing on 404 bodies. A 404 HTML error page
can contain the base brand's name in navigation/footer boilerplate; passing on it means
the residue check declared clean when paths were actually unreachable.

The agent caught this and fixed it (line 1070–1073), but only after marking `rebranded: done`.

**Change:** Add an explicit rule to step-4g-verification.md, in the Brand-residue check
section: fetch with `curl -w '%{http_code}'`; any non-200 status means the path is
unverifiable, not clean — treat it as a failure, not a pass. Do not check the body of a
non-200 response for residue.

**Files to edit:**
- `docs/step-4g-verification.md` — Brand-residue check section: add the status-check
  requirement before the body-grep step.

---

## 5. Suggest `/compact` at Step 4 completion

**What happened:** `/context` showed 152.8k/200k (76%) after Step 4 completed, with
messages at 138.2k tokens (69%). Step 5 generates significant output (pipeline polling,
per-asset logs, DA image uploads). The autocompact threshold is ~167k (200k - 33k buffer),
so Step 5 would likely trigger autocompact mid-step unpredictably.

**Change:** At the end of step-4g-verification.md completion-report paragraph, add:
"Check context usage (`/context`). If messages are above 60%, tell the operator:
'Before I start the asset step, run `/compact` — that'll keep the session clean through
enrichment and collections.' Wait for them to confirm before proceeding to Step 5."

Note: `/compact` is a user-typed command; the agent surfaces the suggestion, doesn't invoke it.

**Files to edit:**
- `docs/step-4g-verification.md` — completion report paragraph (last section): add the
  context-check and `/compact` suggestion.

---

## Implementation order

3 → 2 → 1 → 5

(3 is the most correctness-critical; 2 is a state-integrity fix; 1 is a UX improvement;
5 is low-stakes.)
