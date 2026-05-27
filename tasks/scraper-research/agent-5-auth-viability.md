# Agent 5 — Auth Viability for T5' (User-Auth-Capture Cockpit Flow)

**Research date:** 2026-05-19
**Scope:** 23 award programs. For each, document login requirement, MFA flavor, session cookies, cookie lifetime/portability, post-login URL, and resulting T5' priority.
**Method:** Public sources only (no live logins). FlyerTalk, airline help pages, blog deep-dives (OMAAT, TPG, AwardWallet, AwardFares, 10xTravel), Reddit /r/awardtravel, and known third-party scraper behavior. Cookie names and lifetimes are from cookie-policy pages, browser inspection writeups, and where unobservable without login, marked `(unverified — confirm in Phase 2.5 dev work)`.

## Per-program table

| Program | Login required? | MFA flavor | Session cookies (best evidence) | Cookie lifetime | Portable? | Post-login URL | T5' priority |
|---|---|---|---|---|---|---|---|
| **AA AAdvantage** (aa.com) | **Optional** — anonymous award search works on `/booking`; logged-in shows promo awards and Loyalty Point AAdvantage offers | Email OTP only (no SMS, no TOTP), 15-min expiry, gradual rollout since June 2024; required for password resets and risky logins (device fingerprint change) | `JSESSIONID`, `aalToken` (auth, HttpOnly), `aa_cuk_aalToken` (refresh), `dtCookie`, `dtPC` (Dynatrace fingerprint), `_abck`/`bm_sz`/`bm_sv` (Akamai BMP) (unverified — confirm cookie names) | Auth cookie ~30 min sliding; Akamai sensor cookies typically 1 hr `_abck`, session-only `bm_sz` | **Akamai sensor is non-portable** — `_abck` validates against TLS+IP+UA fingerprint of the session that generated it; copying to another IP/UA fails validation. Auth token *would* replay if Akamai sensor still validates | `/aacom/i18n/aadvantage-program/aadvantage` (account dashboard) or `https://www.aa.com/aadvantage-program/profile/account-summary/` | **Medium** — login unlocks promo/LP awards, but the Akamai layer is the real blocker; auth cookies don't help if sensor.js fingerprint mismatches |
| **AC Aeroplan** (aircanada.com) | **YES — required since March 2025.** Air Canada explicitly cited stopping award scrapers as the reason | SMS or email OTP (6-digit), prompted on new device/browser/incognito/shared-IP; can be turned off in profile but discouraged; mandatory for some account actions | `aco_*` cookies, `JSESSIONID`, `dtCookie`/`dtPC` (Dynatrace), Akamai `_abck` family (unverified — Akamai-fronted) | Session ~20-30 min idle timeout reported on FlyerTalk; refresh cookie ~30 days "remember this device" | Akamai-fronted → sensor cookies tied to TLS/IP/UA. Auth cookie alone won't pass without matching sensor validation. "Remember device" cookie *might* port if device fingerprint cookies also copied | `/aco/home/aeroplan/your-aeroplan/account.html` (account summary) | **HIGH** — login is mandatory; T5' is the ONLY way to scrape Aeroplan post-March-2025 |
| **AF/KL Flying Blue** (flyingblue.com) | **YES** — "Book with Miles" tab requires login. Anonymous users see redirect to login wall | Email or SMS OTP for password reset, suspicious logins, and configurable as always-on by user; no TOTP support per FlyerTalk discussion | `JSESSIONID`, `OAM_REQ`, `ObSSOCookie` (Oracle Access Manager pattern — KLM/AFKL identity stack); also Akamai `_abck`/`bm_sz` (unverified) | Auth session 30 min idle (Oracle AM default); long-lived `ObSSOCookie` if "remember me" used | Oracle AM tokens include IP binding in some configs; portability untested by community. Akamai sensor still applies | `/account/dashboard` or `/en/account.html` | **HIGH** — login is mandatory for award search and AF/KL is a high-value Phase 2 target (Promo Rewards) |
| **AS Alaska Mileage Plan** (alaskaair.com) | **NO** — anonymous works fully; "Use Miles" toggle on homepage flight search. Login only required to *book*, not to search | Email OTP for sensitive actions; not enforced on every login (no SMS by default reported on FlyerTalk) | `JSESSIONID`, `ASIDENTITY`, `ASSESSION` (unverified names) | Standard JSP session ~30 min | N/A for search; if booking, cookies likely have device-binding | `/atmosrewards/account/` or `/mileage-plan/my-account/my-account-overview` | **Low** — no T5' needed for search. Possibly useful for the "Atmos Rewards" personalized offers, but that's a sweetener not a blocker |
| **AV LifeMiles** (lifemiles.com) | **YES** — must log in to search, and account creation requires passport info (high friction) | SMS / email / TOTP (Google Auth, Microsoft Auth) — most flexible MFA in the group. User-configurable; can be turned on/off | LifeMiles uses custom auth tokens (likely JWT in cookie or localStorage). Cookie names not publicly documented (unverified) | Per FlyerTalk: "stay logged in" lasts days; default sliding ~hour | Suspected portable (no Akamai/Cloudflare bot-mgmt reported as blocking 3rd-party tools; AwardFares/seats.aero historically scraped without proxies) — confirm in Phase 2.5 | `/Plan/MyAccount` (account home) | **HIGH** — login mandatory; relatively scraper-friendly once auth is captured; high-value SkyTeam-via-Star partner awards |
| **BA Avios** (britishairways.com) | **YES** — must log in to The British Airways Club to see Avios prices/availability | SMS or TOTP (Google Auth / Microsoft Auth supported via OneLogin integration); enrolled per user | `BIGipServer*` (F5 load balancer), `JSESSIONID`, `bambsig`, `_abck` (Akamai), `bm_sz` (unverified) | Auth ~20 min sliding; F5 cookies session-only | Akamai sensor → not portable across IP/UA. F5 BIG-IP cookies are server-pinning and DO travel | `/travel/loggedinhome/execclub/_gf/en_us` or `/executive-club` | **HIGH** — login mandatory; BA award search is a Phase 2 target |
| **CX Asia Miles** (cathaypacific.com) | **YES** — must sign in at cathaypacific.com to redeem flight awards | SMS OTP standard; biometric (FaceID/TouchID) on mobile app; email recovery | `JSESSIONID`, `CX_*` proprietary cookies, Akamai BMP cookies (unverified) | Auth session ~30 min sliding | Akamai-fronted (sensor.js validation) — not portable. Auth cookie alone insufficient | `/cx/en_US/membership.html` or member dashboard | **HIGH** — login mandatory; CX is high-value (J/F Oneworld) Phase 2 target |
| **DL SkyMiles** (delta.com) | **YES** — "Shop with Miles" requires login on delta.com to see award prices | Email OTP and push notification via Fly Delta app (PingID-backed for some flows); user-configurable in Password & Security | `JSESSIONID`, `delta_pps`, Akamai `_abck`/`bm_sz` family. Delta uses both Akamai BMP and PerimeterX historically (unverified mix) | Auth ~20 min sliding | Multi-layer bot detection — Akamai + PerimeterX (or replacement) makes cookie replay across IP/UA fragile | `/skymiles/profile/` or account dashboard | **HIGH** — login mandatory; Delta is a Phase 2 target but multi-layer defenses mean cookie portability is uncertain |
| **LH Miles & More** (miles-and-more.com / lufthansa.com) | **YES — and requires 7,000-mile minimum balance** to even *search*. Hardest login wall in the group | SMS OTP "MyTravelID" flow on lufthansa.com; required on new device. TOTP not supported in 2026 per Miles & More user community | `MnM_*` proprietary, `JSESSIONID`, Adobe Marketing Cloud cookies, Akamai BMP (unverified). LH uses TravelID single-sign-on across LH/SK/LX/OS family | Auth ~30 min sliding | Akamai + TravelID. TravelID token has device-binding metadata; suspected non-portable | `https://www.miles-and-more.com/row/en/profile.html` or `lufthansa.com/profile` | **HIGH** — login mandatory, 7K-mile floor is annoying. T5' captures past the floor too. Star Alliance award search via LH is uniquely useful for some partner space |
| **NH ANA Mileage Club** (ana.co.jp) | **YES** — explicit redirect to login page for award search / availability calendar | SMS OTP standard; Japanese sites often default to lengthy security questions too | `JSESSIONID`, `WL_TRANS_ANA_*` (WebSphere) (unverified — likely IBM-backed) | Standard JSP session ~30 min | WebSphere clusters use server affinity cookies that pin to one app server — should travel; auth session is the open question | `/asw/`, account dashboard, or specific Mileage Club page | **HIGH** — login mandatory; NH has rich partner award space not visible on UA |
| **TK Miles & Smiles** (turkishairlines.com) | **YES** — must sign in to access award search engine | SMS OTP (default), email fallback; new-device prompted. TOTP not documented | `JSESSIONID`, `THY_*`, Akamai BMP (unverified) | Auth ~30 min sliding; "remember me" cookie weeks | Akamai-fronted → sensor cookies non-portable | `/en-us/miles-and-smiles/` member home | **HIGH** — login mandatory; TK is huge value for Star Alliance partner space and has been a Phase 2 target |
| **UA MileagePlus** (united.com) | **YES (rolling rollout)** — United now requires login for award search per Live and Let's Fly / Upgraded Points (2024-2025 rollout); also unlocks Premier/Chase extra award space | Security-question challenge on new device (NOT a true OTP — questions from drop-down to thwart keyloggers); SMS 2FA in testing; cookie-based "remember this device" | `MP1`, `MP_UNITED`, `SID` (auth), `JSESSIONID`, `dtCookie`/`dtPC`, Imperva/Incapsula `incap_ses`/`visid_incap` cookies (United uses Imperva) | Auth cookie ~20 min sliding; "remember device" cookie multi-month | Imperva cookies bind to IP+UA+TLS; rotating IPs invalidates `incap_ses` after a few mismatches. Auth cookie alone insufficient | `/en/us/mileageplus/account-summary` or `account-page` | **HIGH** — login unlocks elite/Chase extra award space; cookie portability is the big risk on Imperva |
| **VS Flying Club** (virginatlantic.com) | **YES** — must sign in to search reward seats | SMS OTP; biometric on mobile app | `JSESSIONID`, `VSCookie`, Akamai (unverified) | Auth ~30 min sliding | Akamai sensor — non-portable | `/en-US/flying-club/dashboard` or `flywith.virginatlantic.com/account/` | **Medium** — login mandatory but VS award redemptions are niche (Delta, ANA partner). High-value for users targeting those specific routes |
| **AM Club Premier / Aeromexico Rewards** (aeromexico.com) | **NO** — anonymous award search works (one of the few "no login needed" SkyTeam programs). Booking requires login | SMS OTP only; new-device prompted | `JSESSIONID`, `AMID_*`, no observed heavy bot mgmt (unverified) | Standard ~30 min | Likely portable (low bot defenses observed by community scrapers) | `member.aeromexicorewards.com/account` (Spanish) | **Low** — search works anon. Could be Medium if Aeromexico ever tightens, but currently no T5' need |
| **AD TudoAzul / Azul Fidelidade** (voeazul.com.br) | **YES** — account required; typically a Brazilian CPF (foreign workaround exists) | SMS OTP to Brazilian mobile; email fallback | `ASP.NET_SessionId`, `BIGipServer*`, `voegol_*` (unverified) | Standard ~20 min | Low bot defenses; auth cookies suspected portable | `tudoazul.voeazul.com.br/account` | **Medium** — login required, but Azul is a smaller-volume target in Phase 2; T5' is the only path |
| **CM ConnectMiles** (copaair.com) | **YES** — must log in to "Book with miles" | SMS OTP on new device; standard email password reset | `JSESSIONID`, `CM_*`, light bot defenses (unverified) | Standard ~30 min | Suspected portable | `connectmiles.copaair.com/en/web/` member home | **Medium** — login required; low-volume program but Star Alliance partner search via CM has occasional sweet spots |
| **EK Skywards** (emirates.com) | **YES** — must sign into Skywards account for award search and Cash+Miles | SMS OTP standard; biometric on app | `JSESSIONID`, `EK_*`, possibly Akamai (unverified) | Standard ~30 min | Akamai-fronted in some markets; not consistently portable | `/skywards/myaccount` or member dashboard | **HIGH** — login mandatory; EK is rich for J/F redemption discovery (when EK opens partner availability) |
| **ET ShebaMiles** (ethiopianairlines.com) | **YES** — login required for award booking through `shebamiles.ethiopianairlines.com` | Email/SMS OTP (unverified — limited public documentation) | `JSESSIONID`, `WL_PERSISTENT_*` (WebSphere — IBM-backed) (unverified) | WebSphere standard ~30 min idle | WebSphere has server-affinity cookies; if app servers don't pin to IP, portable. Limited community scraping data | `shebamiles.ethiopianairlines.com/dashboard` or member home | **Low-Medium** — login mandatory but ET is a smaller target; limited unique award value for users vs. searching same Star space on UA/Aeroplan |
| **EY Etihad Guest** (etihad.com) | **NO** — explicitly says "search online without creating a login" but "pestered to create account." Booking requires login | SMS OTP; biometric on app | `JSESSIONID`, `ETIHAD_*`, possibly Akamai (unverified) | Standard ~30 min | N/A for anonymous search | `/etihadguest/dashboard` | **Low** — anonymous search works. Possibly Medium if EY's partner-award visibility differs logged-in (some FlyerTalk hints that it does for Etihad-on-AA awards) |
| **SK EuroBonus** (flysas.com) | **YES** — "new portal for booking partner awards is now behind a log-in wall." Star Alliance partner search requires login | SMS OTP via TravelID (shared with LH stack); push via SAS app | `TravelID` cookies (shared LH/SK stack), `JSESSIONID`, Akamai (unverified) | Auth ~30 min sliding | TravelID shared with LH suggests same device-binding properties — non-portable | `/en/eurobonus/account` or member home | **HIGH** — login mandatory; SK is a Phase 2 Star-Alliance-partner target with unique sweet spots |
| **AY Finnair Plus** (finnair.com) | **YES** — must log in to use "Award flights" tab | SMS OTP; email fallback (unverified for TOTP) | `JSESSIONID`, `_AY_*`, light bot defenses historically (unverified) | Standard ~30 min | Suspected portable (community scrapers like AwardFares index AY without heavy proxy use) | `/finnair-plus/account` or member dashboard | **HIGH** — login mandatory; AY has valuable Oneworld partner search (BA, CX, JL) and Avios pricing |
| **B6 TrueBlue** (jetblue.com) | **YES** — Award search ("Use Points") requires login | SMS OTP; security questions on new device; recently rolled out broader MFA | `JSESSIONID`, `JB_*`, Akamai (unverified) | Standard ~30 min | Akamai-fronted in some flows | `/trueblue/account` or member home | **Low** — TrueBlue is revenue-based dynamic pricing, not really "award search" in the traditional sense. Useful but lower-priority |
| **QF Frequent Flyer** (qantas.com) | **Mixed** — anonymous "Rewards" toggle search works for *some* flights (Classic Reward shows availability without login); but full Classic Plus / partner pricing requires login | SMS OTP, TOTP (Qantas Authenticator), security questions; prompted on new device. MFA mandatory since the mid-2024 cyber incident | `JSESSIONID`, `QF_*`, Akamai cookies (unverified) | Auth ~30 min sliding | Akamai-fronted → sensor cookies non-portable | `/au/en/frequent-flyer/dashboard.html` | **Medium-High** — anonymous works for partial search but login unlocks the full picture. T5' valuable for QF Classic Plus visibility |
| **QR Privilege Club** (qatarairways.com) | **YES** — must log in to see Avios prices and search award seats. Needs Avios in account to fully see options | SMS OTP; email fallback (unverified for TOTP) | `JSESSIONID`, `QR_*`, F5 BIG-IP cookies, Akamai (unverified) | Standard ~30 min | Akamai-fronted → not portable | `/en/Privilege-Club/dashboard` or member home | **HIGH** — login mandatory; QR is high-value Oneworld partner search (J/F sweet spots) |
| **SV Alfursan** (saudia.com) | **YES** — must log in; verification code sent to registered mobile to log in (de-facto SMS MFA on every login) | SMS OTP **on every login** (not just new device) — strongest enforcement in the group | `JSESSIONID`, `SV_*`, light bot defenses (unverified) | Standard ~30 min | SMS-every-login means session re-auth is frequent; cookies suspected portable for the session duration only | `alfursan.saudia.com/en/account` member home | **Low-Medium** — login mandatory and SMS every login is painful for the cockpit modal flow. SV award space is niche; not a top Phase 2 priority |
| **SQ KrisFlyer** (singaporeair.com) | **YES** — must log in to KrisFlyer to search awards | SMS OTP (default to registered mobile, 3-min expiry); email fallback. No TOTP | `JSESSIONID`, `KF_*`, Akamai (unverified — SQ uses Akamai BMP) | Auth ~20 min sliding | Akamai-fronted → sensor cookies non-portable. Auth replay only works if sensor still validates | `/kf/account` or member home | **HIGH** — login mandatory; SQ has uniquely-released own-metal J/F space only visible to KrisFlyer members |
| **G3 Smiles** (voegol.com.br) | **YES** — Smiles requires login (foreign-friendly signup exists; no CPF needed) | SMS OTP to Brazilian mobile; email fallback | `JSESSIONID`, `Smiles_*`, light defenses (unverified) | Standard ~30 min | Suspected portable | `smiles.com.br/account` | **Medium** — login required; G3 Smiles is a high-value SkyTeam-via-partners program but T5' for Brazilian SMS is logistically harder for non-BR users |
| **VA Velocity** (virginaustralia.com) | **YES** — must log in to Velocity to book/search award flights | SMS OTP; email fallback; new-device challenge | `JSESSIONID`, `VA_*`, light defenses (unverified) | Standard ~30 min | Suspected portable | `velocityfrequentflyer.com/member-home` | **Low-Medium** — login mandatory; VA Velocity is niche (Australia-focused) and partner search is also possible via QF/Alaska |

## Top 5 airlines where T5' user-auth-capture is REQUIRED for award search

These are the programs where the user *cannot* see award availability at all without a logged-in session. T5' is the only viable path:

1. **AC Aeroplan** — Hard requirement since March 2025. Air Canada explicitly built the login wall to stop scrapers; T5' is the only legitimate workaround. **Highest priority** for Phase 2.5.
2. **LH Miles & More** — Login + 7,000-mile balance floor. T5' both passes the login *and* captures an account that already has the balance.
3. **UA MileagePlus** — Rolling login enforcement since late 2024; logged-in unlocks elite/Chase extra award buckets.
4. **SQ KrisFlyer** — Login mandatory and own-metal J/F awards are uniquely visible only to KrisFlyer members.
5. **AV LifeMiles** — Login mandatory, passport info needed for signup. Once auth is captured, scraper-friendly back end.

Honorable mentions (any one of these could swap into the top 5): **BA Avios**, **CX Asia Miles**, **QR Privilege Club**, **TK Miles & Smiles**, **SK EuroBonus**, **NH ANA**, **DL SkyMiles**, **AF/KL Flying Blue**.

## Top 5 airlines where T5' is OPTIONAL but improves results

Anonymous search works, but logged-in shows more space, better pricing, or extra elite-only inventory:

1. **AA AAdvantage** — Anonymous works for the Booking Engine, but logged-in surfaces Loyalty Point Rewards promos, AAdvantage member-only Web Specials, and (in some cases) wider award space.
2. **QF Frequent Flyer** — Anonymous Classic Rewards toggle works for partial search; logged-in shows full Classic Plus, member-only sweeteners, and complete partner pricing.
3. **EY Etihad Guest** — Anonymous search is officially supported, but FlyerTalk reports indicate logged-in users see partner award availability that anonymous users don't.
4. **AM Aeromexico Rewards** — Anonymous works; logged-in unlocks the booking flow. Search is parity but the *act of booking* requires auth, so T5' becomes useful for end-to-end flows.
5. **AS Alaska Mileage Plan** — Anonymous works fully for search; logged-in unlocks Atmos Rewards personalized offers and booking. T5' value is mostly the booking flow, not the search itself.

## Airlines where T5' doesn't help (anonymous works as well as logged-in)

These programs return identical award search results whether you're logged in or not — T5' adds zero value for *search* (it might still be useful for *booking*, but that's out of scope for the cockpit-scrape product):

- **AS Alaska Mileage Plan** — Search is identical anonymous vs. logged-in; only Atmos personalization differs.
- **AM Aeromexico Rewards** — Search parity (per AwardWallet documentation).
- **EY Etihad Guest** — Officially anonymous-friendly (mostly — see "improves results" caveat above).

Everywhere else in this list, T5' helps for *something* — even if it's only the booking flow.

## Recommended Phase 2.5 prioritization order

Sequence by "blocker severity × scraper value × T5' implementation cost." Lower-cost programs first to validate the cockpit flow, then tackle the high-value high-cost ones:

### Tier 1 — Implement first (login walls + high scraper value + simpler MFA)

1. **AC Aeroplan** — The reason T5' exists. Email OTP or SMS, recognizable post-login URL (`/aco/home/aeroplan/your-aeroplan/account.html`), Air Canada acknowledges the requirement publicly so legal posture is clean. Validates the whole cockpit flow.
2. **UA MileagePlus** — Security-question MFA (drop-down, no SMS gate on most logins) is the easiest to handle in the cockpit modal. Imperva on the back end is the worry — verify cookie portability before committing.
3. **LH Miles & More / TravelID** — SMS OTP; logging in once gets a TravelID that *might* work across LH/SK/LX/OS. If true, one T5' capture unlocks 4 carriers — huge ROI.

### Tier 2 — High value, harder MFA

4. **SQ KrisFlyer** — SMS OTP, 3-min expiry. Tight modal timing. High user demand.
5. **AV LifeMiles** — User can pick SMS / email / TOTP via account settings; if Pointsnap recommends TOTP setup, the flow becomes deterministic. Scraper-friendly back end is a major upside.
6. **BA Avios** — Supports TOTP. Akamai sensor.js is the back-end risk; if cookies don't replay, T5' isn't enough — need browser session pass-through.
7. **AF/KL Flying Blue** — SMS/email OTP; Promo Rewards is high-value content behind the login wall.

### Tier 3 — High value, complex MFA or known scraper hostility

8. **DL SkyMiles** — Multi-layer Akamai + PerimeterX; expect cookie replay to be fragile.
9. **CX Asia Miles** — Akamai-fronted; same risk pattern as DL.
10. **QR Privilege Club** — Akamai + must-have-Avios floor for full visibility.
11. **NH ANA Mileage Club** — Japanese-language UX and IBM WebSphere back end; verify portability.
12. **TK Miles & Smiles** — Akamai-fronted; Turkish-locale account creation friction.

### Tier 4 — Lower priority

13. **SK EuroBonus** — Bundled into LH TravelID work in Tier 1.
14. **AY Finnair Plus** — High-value Oneworld partner search; smaller user base.
15. **VS Flying Club** — Niche redemption use cases.
16. **EK Skywards** — High Akamai risk, niche partner availability.
17. **G3 Smiles** / **AD TudoAzul** — Brazilian SMS challenge; tackle when LATAM market becomes a priority.
18. **CM ConnectMiles** — Niche.
19. **B6 TrueBlue** — Revenue-based; less "award search" character.
20. **VA Velocity** — Australian-locale, can be covered partially via QF/Alaska.
21. **SV Alfursan** — SMS-on-every-login is painful and award space is niche.
22. **ET ShebaMiles** — Star space largely visible elsewhere.

### Skip T5' (anonymous is sufficient for search)

23. **AS Mileage Plan** — anonymous works.
24. **AM Aeromexico Rewards** — anonymous works.
25. **EY Etihad Guest** — anonymous works (with caveat that logged-in *may* show more partner space — re-evaluate after Phase 2 data).

## Cross-cutting notes for implementers

- **The Akamai sensor.js layer is the actual blocker, not the auth cookie.** Every airline above with "Akamai-fronted" in the cookie row means the auth cookie alone won't replay — you also need the `_abck` cookie generated by a real browser whose TLS fingerprint, IP, and User-Agent match what the worker will replay later. This is the bigger Phase 2.5 design question than auth itself. For programs not behind Akamai (AV LifeMiles, AM, AD, CM, AY, G3, VA suspected), cookie replay from any IP should work.
- **TLS fingerprint matters.** When the cockpit streams a browser to the user for login, the *browser's* TLS fingerprint and UA become the signature the worker must mimic later. Camoufox/Patchright are needed worker-side; matching the cockpit's fingerprint to the worker's is non-trivial.
- **MFA frequency matters for UX.** Carriers that prompt MFA only on new-device (most of the list) are easy: cockpit captures once, worker replays cookies for the session lifetime. Carriers that prompt MFA on every login (SV Alfursan, possibly TK depending on rate of IP rotation) make the cockpit flow painful and the worker session short.
- **"Remember this device" cookies** are the secret sauce. Aeroplan, UA, BA, and others all set long-lived "trusted device" cookies that bypass MFA on subsequent logins. If the cockpit captures those, the worker can re-login without MFA when sessions expire. Phase 2.5 should explicitly target these cookies during the cockpit capture, not just the short-lived session cookies.
- **Post-login URL detection.** For each program, the cockpit modal needs a robust "login success" signal. The post-login URLs in the table are the *most common* destinations, but redirects vary by promo, marketing flag, A/B test. Recommend matching on a stable substring (e.g. `/aadvantage-program/profile/`, `/aco/home/aeroplan/your-aeroplan/`, `kfLogin.form` -> `/kf/account`) plus a positive DOM signal (e.g. account number visible, sign-out link present).
- **Confirm unverified cookie names in Phase 2.5 dev work.** Many cookie names in this report are inferred from common stacks (Akamai BMP cookies, Oracle Access Manager, IBM WebSphere, F5 BIG-IP). Verify by inspecting real logged-in sessions with browser devtools before encoding cookie-name assumptions into the worker.

## Success criteria checklist

- 23 programs documented: yes
- Each has at least login-required Y/N: yes
- Each has at least an MFA flavor (or "none observed"): yes
- Top-5 required, top-5 optional, "doesn't help" all listed: yes
- Phase 2.5 prioritization order provided: yes
