# Plan — fix the screenshot-loop in rebrand-portal Step 4g

## Problem
- Whirlpool run finished the portal correctly, but wasted ~10 min at verification.
- Agent got stuck trying to `screencapture` a locked screen, then chased browser tools that don't exist in-session.
- Root cause: `docs/step-4g-verification.md` mandates screenshots as required steps, so the agent obeyed and treated a blocked screenshot as a hard blocker instead of moving on.
- Everything a screenshot would confirm (colors, logo, layout) is already provable by reading the CSS/HTML the site serves — no browser needed. The doc states this principle once (line 82) but doesn't apply it elsewhere.
- Second gap: doc lines 27–33 tell the agent NOT to run local dev, so for the auth-gated facets page it was boxed in — no screenshot, no browser tool, no local fallback.

## Fix
Single doc edit: `docs/step-4g-verification.md`. Reorder verification into a cheapest-first ladder and demote screenshots.

### Verification ladder (new)
1. **Deterministic = the gate.** `verify.mjs` (residue, header-logo, applied-css, nav-404-loop) + served-CSS / `.plain.html` fetches. These ARE pass/fail. Generalize the line-82 principle ("binary pass/fail per selector, not a screenshot judgment call") to the whole doc.
2. **Rendered DOM (only when a check needs the authenticated page).** Run local dev with `DISABLE_AUTHENTICATION`, fetch `localhost`, read served/computed values. Closes the auth gap without a screenshot.
3. **Screenshot = optional confirmation. Never a gate, never a blocker.** If the screen is locked or no browser tool exists: flag the residual item and CONTINUE. Do not loop.

### The one honest carve-out
- Third-party facets-widget checked/hover state is NOT in our CSS → no grep or served-CSS check can see it. That is a noted follow-up for a human eyeball, not a hard gate, and not faked with a brittle stylesheet grep.

### Contradiction to fix
- Lines 27–33 ("deployed PR worker needs no login bypass — only reach for local before a PR exists") → rewrite so local dev is the PRESCRIBED fallback for reaching an auth-gated page when no browser tool is available.

## Save a feedback memory
- New file under memory/, type `feedback`: "CSS/DOM-diff is the gate; screenshot is optional confirmation; run local to reach gated pages; never halt on a blocked screenshot." + one-line pointer in MEMORY.md. Carries the lesson across sessions, beyond this one skill.

## Files touched
- `.claude/skills/rebrand-portal/docs/step-4g-verification.md` — the doc edit.
- `memory/<slug>.md` + `MEMORY.md` — the feedback memory.

## Next step
- On approval: show exact before/after diff of the doc's screenshot sections (lines ~27–33, ~194–242) before writing.
