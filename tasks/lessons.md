# PointSnap — Lessons Learned

Per CLAUDE.md §3: after any correction from the user, write the pattern here so the same mistake doesn't repeat.

## Session 2 (2026-05-17)

### Always invoke `apple-hig` skill before any UI/UX work
Codified in CLAUDE.md top section. No exceptions, even for "small" design changes like badge colors or row-height tweaks.

### When mock data is the right call, defend it explicitly
User asked "do we need fake data instead of starting with real" and "build scrapers from the beginning … unless you feel strongly otherwise." Stayed with mock data and explained why: one scraper covers ~5 partner programs, the spreadsheet needs all 13 columns to design against, scraper infrastructure is days-to-weeks of co-design overhead, and mock data takes ~1 hour while scrapers take days. User accepted. Document the cost/benefit when the architecture answer differs from the user's first instinct.

### Don't generate a `down` migration in Drizzle, use Neon PITR
Drizzle-kit doesn't generate down migrations. Mitigation: Neon point-in-time recovery for "oh no" moments, additive-only changes within a release, destructive changes in a follow-on release. Codified in `docs/planning/04-data-model.md` §6.

### Pin pnpm to 10.33 in package.json — pnpm 11 enforces strict-dep-builds
pnpm 11.x treats ignored build scripts (sharp / @clerk/shared / esbuild / unrs-resolver) as fatal exit-1, even on a successful CLI run. Setting `packageManager: "pnpm@10.33.0"` in package.json restores the prior behavior. Necessary for `drizzle-kit generate` to work in CI/dev.
