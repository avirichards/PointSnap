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

## Session 3 (2026-05-18) — Scrapers

### IPRoyal residential username vs password targeting
IPRoyal's geo/session targeting attaches to the **password** field, not the username. Format: `password_country-us_session-xxx_lifetime-10m`. Putting suffixes on the username causes `ERR_PROXY_AUTH_UNSUPPORTED` from Chromium. Default to `country-us` since most target sites are US-based and the bare residential pool returns random global exits (observed Vietnam IP, which then gets geo-filtered by airline edges).

### IPRoyal blocks airline domains at the proxy layer
`aa.com`, `delta.com`, and `aircanada.com` return `ERR_TUNNEL_CONNECTION_FAILED` regardless of exit country — IPRoyal refuses CONNECT requests to these specific domains at the upstream proxy server. They aren't on the public abuse list but are clearly filtered. Unblocking requires emailing IPRoyal support (their docs explicitly say no self-service). For these three sites we need a different proxy provider or a render-as-a-service (ZenRows / Bright Data Web Unlocker / ScraperAPI).

### Akamai blocks Fly datacenter IPs even for sites IPRoyal doesn't reach
Earlier session believed Fly direct egress worked for `aircanada.com`; re-tested 2026-05-18 and got 403 "Access Denied" with `errors.edgesuite.net` reference — Akamai has the Fly IP range on their blocklist now. So the `use_proxy=False` AC fallback no longer works.

### `united.com` silently drops connections from both Fly and IPRoyal
Both Fly direct egress and IPRoyal US-residential exits time out on `Page.goto` to `https://www.united.com/en/us/fsr/choose-flights` — even with `wait_until=commit` (which fires on first byte). Their edge is blackholing these IPs at the TCP level. Needs a different scraping approach: render-as-a-service, mobile proxy, or paid clean-IP pool.

### `britishairways.com` returns "Information Page" interstitial through residential
Even with GB-targeted IPRoyal exit (BT residential 82.28.x), BA serves a queue/throttle page titled "British Airways - Information Page" instead of the login form. The page body says "We are experiencing high demand on ba.com at the moment". This is an Akamai-style load-shedder triggered by automation heuristics. Workaround: try direct API endpoints (skip the consumer login UI), use a queue-skipper service, or accept BA stays canonical.

### What works as of 2026-05-18
- **VS_FLYING_CLUB**: live (calendar API, no Akamai gating)
- **AS_MILEAGEPLAN**: live (SvelteKit SSR — alaskaair.com not protected by Akamai for that route)
Both via IPRoyal US-residential. All other 11 plugins hit one of the blockers above.
