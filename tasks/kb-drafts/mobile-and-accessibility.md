# Mobile + accessibility refinements

**Status:** Draft for KB. Not yet published.
**Surface:** All pages (`/search`, `/wallet`, `/admin`, `/sign-in`, `/sign-up`)
**Shipped:** 2026-05-17

## Summary

Tightened the cockpit + side pages against Apple's Human Interface Guidelines. No new features — every button, badge, and toggle just feels right on phone now.

## What changed

**Tap targets** — Apple's HIG (and WCAG accessibility) says any tap target should be at least **44 × 44 points**. The header navigation, theme toggle, "Compact / Group by flight" toggles in the spreadsheet, expand-alternative-programs chevron in each row, and form submit buttons were 32–36pt before; now all 44pt+. This makes phone use a lot less fiddly — fat-finger taps land where you expect.

**Badge contrast** — The freshness badges (Fresh / Aging / Stale) and the "Low" confidence badge used the same bright color for both background tint AND text. In light mode the result was washed-out, low-contrast yellow-on-white that failed WCAG AA. Now each freshness color has a separate **dark text** in light mode and **bright text** in dark mode, both passing accessibility contrast. The chip is also slightly more visible — background opacity bumped from 15% to 20%.

**Screen reader access** — On phone, the header nav buttons (Search / Wallet / Admin / Sign-in / Theme toggle) hide their labels and show only icons. Before this change, screen readers got nothing — the labels were hidden via `display: none`, which strips them from assistive tech. Now each icon-only button has an explicit accessible name, so VoiceOver and TalkBack announce them correctly.

## Where to verify

If you want to confirm anything on phone:

1. Open `/search` and tap the spreadsheet expand chevron on any row with multiple ticketing programs — should be easy to hit on the first try.
2. Toggle dark/light mode in the header — the freshness badges in the table should remain readable in both modes (the difference is most visible on the "Stale" / yellow chips).
3. Open the sign-in or sign-up form on phone — inputs are 44pt tall, submit button full-width, labels readable.

## What's NOT in this update (yet)

- Skip-to-main-content link for screen-reader users (Phase 2 hygiene).
- Full WCAG audit beyond the highest-risk spots flagged above. Specifically: cabin-tint cells (Y / W / J / F) in the spreadsheet weren't reviewed in this pass; they appear to pass contrast but no formal check ran.
- Reduced-motion preference — the chevron expand has a transition that respects `motion-reduce` already; other animations are minimal and unaffected.

## What to update in the FAQ

If the FAQ mentions accessibility or mobile usability, this is a good chance to add a "designed to Apple HIG standards" line. No behavioral changes for users; just a quality bar bump.
