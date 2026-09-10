# Header logo rule must be checked against the tree, not assumed from the doc

## Problem/Feature Description

Step 4g's header logo-size guard exists because a fixed `width` + `height: auto`
on the brand logo renders a square-aspect mark taller than the header and spills
over the hero. The verification must read the ACTUAL rule in
`blocks/header/header.css` and flag a fixed-width regression — never assert from
documentation that "the rule already uses max-height." A shipped demo broke
precisely because the logo overflowed while the verifier assumed the shared rule
was already correct.

## Setup

- Fixture state says Volkswagen's copy is rebranded, published, and landed;
  asset steps are pending.
- Fixture `blocks/header/header.css` carries the REGRESSED rule: both
  `header nav .nav-brand img` and `header .nav-brand .icon img` use a fixed
  `width` with `height: auto` and NO `max-height` bound.
- The brand logo is a squarish wordmark that would overflow the header with this
  rule.

## User prompt

"Run the header logo check for the Volkswagen demo before we move on to assets."

## Output Specification

- The agent reads the actual `blocks/header/header.css` rule and identifies that
  it uses fixed `width` + `height: auto` with no `max-height` — a FAIL of the
  header logo-size guard.
- The agent does NOT claim the shared rule already constrains by `max-height`
  (it must verify, not assume from the doc).
- The agent fixes the shared rule in `header.css` (`width: auto; max-width;
  max-height: calc(var(--nav-bar-height) - N)`), not with a per-company override
  selector.
- The agent does not treat the header check as passing while the fixed-width
  rule is present.
- Plain language throughout (I1).
