# Scraper Blockers — Path Forward (2026-05-18)

## Current state: 2 of 13 plugins returning live data

| Program | Marketing page (Fly direct + H2) | Booking widget | Status |
|---|---|---|---|
| **VS_FLYING_CLUB** | n/a (calendar API) | ✓ | **LIVE** |
| **AS_MILEAGEPLAN** | n/a (SSR endpoint) | ✓ | **LIVE** |
| AC_AEROPLAN | ✓ 200 OK | ✗ 403 (path-protected by Akamai) | needs proxy / Web Unlocker |
| NH_ANA | ✓ 200 OK | ✗ aswbe-i.ana.co.jp times out | needs proxy / creds + investigation |
| LH_MILES_MORE | ✓ 200 OK | ✗ login URL 404 in plugin (wrong URL) | URL fixable, then probably works |
| AA_AADVANTAGE | ✗ Akamai 403 from Fly; IPRoyal CONNECT refused | — | needs different proxy |
| DL_SKYMILES | ✗ Akamai 444 from Fly; IPRoyal CONNECT refused | — | needs different proxy |
| UA_MP | ✗ H2 protocol error from Fly; IPRoyal timeouts | — | needs different proxy |
| BA_AVIOS | ✗ "Information Page" queue from IPRoyal | — | needs queue-skipper or different proxy |
| AF_FLYINGBLUE | ✗ H2 protocol error from Fly; IPRoyal timeouts | — | needs different proxy |
| TK_MILES_SMILES | ✗ H2 protocol error from Fly; IPRoyal timeouts | — | needs different proxy |
| CX_CATHAY | ✗ H2 protocol error from Fly | — | needs different proxy |
| AV_LIFEMILES | ✗ Akamai 403 from Fly | — | needs different proxy |

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
- Fixed the IPRoyal username/password targeting (suffix goes on password, not username — earlier session had it wrong, getting ERR_PROXY_AUTH_UNSUPPORTED)
- Added sticky session support for IPRoyal (keeps the same exit IP across requests in one scrape — needed for Akamai _abck cookie validation)
- Added `/diag/ac_scrape` and `/diag/ua_scrape` endpoints that run the actual scrape with full per-step diagnostics surfaced into the response (so we don't need fly logs to debug)
- Made HTTP/2 toggleable per call (some sites need it, others break with it)
- Confirmed VS and AS still live after these changes
- For AC: enabled HTTP/2 + cookie warmup via homepage + Referer header — still 403 on booking widget. Akamai's path-level rule needs more than cookies+Referer (likely sec-cpt challenge or auth token).
- Confirmed via direct probes: aircanada.com homepage, ana.co.jp, lufthansa.com all reachable from Fly direct + HTTP/2 (200 OK). Their booking/login subdomains either 404 (LH plugin URL wrong) or 403 (AC widget) or timeout (ANA aswbe-i).

## Verified-blocked summary

Even with every workaround tried (Patchright stealth, US geo, sticky sessions, cookie warmup, Referer chaining, HTTP/2 toggle), these airlines remain unreachable from our infrastructure:

- **Akamai-blocked at TLS/edge**: aa.com, delta.com, united.com, lifemiles.com, flyingblue.com, klm.com, turkishairlines.com, cathaypacific.com, airfrance.com
- **Akamai-blocked at booking widget path** (homepage works): aircanada.com
- **Queue-throttled**: britishairways.com
- **IPRoyal CONNECT refused** (regardless of country): aa.com, delta.com, aircanada.com

The pattern: airline sites that depend on Akamai BMP have all blocklisted Fly's datacenter IP range and IPRoyal's residential pool. Beating this requires either pristine IPs (Bright Data residential at ~$15/GB) or a render-as-a-service that pools their own clean IPs + browsers (ZenRows, Bright Data Web Unlocker, ScraperAPI).

## What I'd need from you

1. **Pick one of A/B/C/D/E above.** A is the recommended path.
2. If A: I need a ZenRows API key. They have a free trial (~1k requests) to validate before commit.
3. If B/C/D: Same — API key/account.

If you don't pick, I'll stay on E and the remaining 11 plugins keep returning canonical seeds.
