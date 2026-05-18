# Scraper Blockers — Path Forward (2026-05-18)

## Current state: 2 of 13 plugins returning live data

| Program | Status | Why |
|---|---|---|
| **VS_FLYING_CLUB** | ✓ LIVE | Calendar API, no Akamai gating |
| **AS_MILEAGEPLAN** | ✓ LIVE | SvelteKit SSR, alaskaair.com not heavily protected |
| AC_AEROPLAN | ✗ blocked | IPRoyal refuses CONNECT to aircanada.com; Fly direct returns Akamai 403 |
| AA_AADVANTAGE | ✗ blocked | IPRoyal refuses CONNECT to aa.com; Fly direct returns Akamai 403 |
| DL_SKYMILES | ✗ blocked | IPRoyal refuses CONNECT to delta.com; Fly direct returns Akamai 444 |
| UA_MP | ✗ blocked | united.com Akamai silently drops TCP from both Fly and IPRoyal IPs |
| BA_AVIOS | ✗ throttled | Returns "Information Page" queue/throttler instead of login form |
| AF_FLYINGBLUE | ✗ blocked | airfrance.com timeout |
| TK_MILES_SMILES | ✗ blocked | turkishairlines.com timeout |
| AV_LIFEMILES | ✗ blocked | avianca.com returns Akamai 403 |
| NH_ANA | not tested | no creds yet |
| CX_CATHAY | not tested | no creds yet |
| LH_MILES_MORE | not tested | no creds yet |

## Root cause: IP reputation

The IPs we control are flagged by airline edge providers (Akamai, Imperva, Shape Security):

1. **Fly's datacenter IPs** — Akamai 403/444 "Access Denied" on aa.com, delta.com, aircanada.com, avianca.com.
2. **IPRoyal residential pool** — IPRoyal's upstream proxy refuses CONNECT to aa.com, delta.com, aircanada.com at the protocol level (ERR_TUNNEL_CONNECTION_FAILED). For other airline domains (united, airfrance, turkish) the CONNECT succeeds but Akamai then silently drops the TCP stream from our exit IP.

This isn't a code problem — it's an IP-reputation problem. Patchright/stealth-browser defeats Akamai's *fingerprinting* checks but not their *IP blocklist* checks.

## Options to unblock the remaining 11 plugins

### Option A — ZenRows (pay-per-request render-as-a-service)
- Sign up, get API key
- Replace `await page.goto(url)` with `await zenrows_get(url)` per failing plugin
- ZenRows handles browser farm + residential pool + CAPTCHAs on their side
- Cost: ~$1.50/1000 requests with JS rendering — ~$50/mo at 30k searches
- **Pros:** drop-in, no proxy setup, covers all airlines at once
- **Cons:** vendor lock-in for the scraping layer, latency adds ~2-3s/request

### Option B — Bright Data Web Unlocker
- Highest reliability for the hardest sites (AA/UA/DL)
- ~$3/1000 requests with full unblock
- Minimum $500 commitment to start
- **Pros:** Akamai-proof, used by major scraping operations
- **Cons:** expensive, $500 min spend

### Option C — Switch residential proxy provider to one without airline blocklists
- SOAX (~$8.50/GB), Smartproxy (~$8.50/GB), NetNut ISP proxies (~$15/GB)
- Test sites individually to confirm no blocklist
- Keep our existing scraper code (Patchright + per-plugin XHR capture)
- **Pros:** cheaper per-search than ZenRows/Bright at volume
- **Cons:** doesn't bypass Akamai IP-reputation for sites where it's already triggered (UA, AA edge). May still need to combine with rotating mobile pool

### Option D — Seats.aero API (skip scraping entirely for some programs)
- $30/mo personal tier
- Provides Aeroplan, BA Avios, Alaska, Virgin, Delta, United search results directly
- **Pros:** zero infra burden for covered programs
- **Cons:** doesn't cover all 13 (no AF, TK, LH, NH, CX, AV), points data is theirs

### Option E — Accept canonical fallback for the blocked programs
- Keep VS + AS live
- All other 11 return canonical seed (fixed-point estimates from charts)
- **Pros:** no spend
- **Cons:** stale data, marketing "live data" claim only true for 2/13

## Recommendation

For a personal-use cockpit, **Option A (ZenRows)** is the cheapest path to live data on all 13 programs:
- Tractable spend (~$50/mo)
- Solves the proxy block AND Akamai reputation in one move
- Existing per-plugin XHR-capture code can be adapted to ZenRows' JS-rendering response
- Can drop ZenRows for any specific plugin if we find a cheaper direct path later

If we expect heavy use (>100k searches/mo), **Option C + Option D combined** is cheaper at scale but more complex to operate.

## What I've done in this session without your decision

- Forced IPRoyal exits to country=US (was returning random global IPs, including Vietnam — airline edges geo-filtered those)
- Added sticky session support for IPRoyal (keeps the same exit IP across requests in one scrape — needed for Akamai _abck cookie validation)
- Added `/diag/ac_scrape` and `/diag/ua_scrape` endpoints that run the actual scrape with full per-step diagnostics surfaced into the response (so we don't need fly logs to debug)
- Made HTTP/2 toggleable per call (some sites need it, others break with it)
- Confirmed VS and AS still live after these changes

## What I'd need from you

1. **Pick one of A/B/C/D/E above.** A is the recommended path.
2. If A: I need a ZenRows API key. They have a free trial (~1k requests) to validate before commit.
3. If B/C/D: Same — API key/account.

If you don't pick, I'll stay on E and the remaining 11 plugins keep returning canonical seeds.
