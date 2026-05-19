# PointSnap Scraper Transport Rubric

**Phase 0 output.** Per-airline transport recommendation derived from 8 parallel research agents. Drives every transport decision in Phases 1-3.

## Transport tiers

| Code | Transport | Cost/req | Notes |
|---|---|---|---|
| T0 | `httpx` direct | $0 | Plain JSON API, no bot wall |
| T1 | `httpx` + IPRoyal residential | ~$0.0005 | IP-reputation gate but otherwise open |
| T2 | Camoufox + IPRoyal | ~$0.001 | Mild bot defense (PerimeterX lite) |
| T3 | Camoufox + BD Residential (country-targeted, sticky) | ~$0.005 @ $8/GB | Akamai BMP, DataDome, hard walls |
| T4 | Camoufox cookie-mint → `curl_cffi` API replay | ~$0.003 | Post-form Challenge Validation wall |
| T5' | User-initiated auth capture (cookie replay) | ~$0.001 | Login-required + MFA-gated (Phase 2.5) |
| T6 | Mobile API endpoint | ~$0.001 | Web hard-walled but mobile is open |
| T7 | Commercial fallback (Duffel / Amadeus) | $0.50-1.50 | When all free paths fail |
| T8 | Partner-airline backdoor (cross-check only) | varies | Corroboration, never primary |

## Per-airline rubric

> **Status legend**: ⬜ awaiting Phase 0 agent | ✅ classified | ❌ no viable path identified

| Program | Domain | Primary CDN/WAF | Recommended T | Fallback T | Mobile? | GraphQL? | T5' needed? | Commercial fallback | Effort | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| AA_AADVANTAGE | aa.com | ⬜ Akamai BMP (known) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| AC_AEROPLAN | aircanada.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | Login-gated post-2024 redesign |
| AF_FLYINGBLUE | flyingblue.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| AS_MILEAGEPLAN | alaskaair.com | ✅ none (SSR) | T0 ✅ | T1 | ⬜ | ⬜ | ❌ | ⬜ | S | **WORKING** via httpx |
| AV_LIFEMILES | lifemiles.com | ⬜ Akamai (known) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| BA_AVIOS | britishairways.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| CX_CATHAY | cathaypacific.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| DL_SKYMILES | delta.com | ⬜ Akamai (known) | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| LH_MILES_MORE | miles-and-more.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| NH_ANA | ana.co.jp | ⬜ JSF/JSP | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| TK_MILES_SMILES | turkishairlines.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| UA_MP | united.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | |
| VS_FLYING_CLUB | virginatlantic.com | ✅ none (JSON API) | T0 ✅ | T1 | ⬜ | ⬜ | ❌ | ⬜ | S | **WORKING** via httpx |
| AM_CLUB_PREMIER | aeromexico.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| AD_AZUL | voeazul.com.br | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| CM_CONNECTMILES | copaair.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| EK_SKYWARDS | emirates.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| ET_SHEBAMILES | ethiopianairlines.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| EY_GUEST | etihad.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| SK_EUROBONUS | flysas.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| AY_FINNAIR_PLUS | finnair.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| B6_TRUEBLUE | jetblue.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| QF_FF | qantas.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| QR_PRIVILEGE | qatarairways.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| SV_ALFURSAN | saudia.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| SQ_KRISFLYER | singaporeair.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| G3_SMILES | voegol.com.br | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |
| VA_VELOCITY | virginaustralia.com | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | NEW |

---

## Country-geo map (for BD Residential `-country-XX` username modifier)

| Airline | Country code | Why |
|---|---|---|
| AA, AS, B6, UA, DL | `us` | US-domestic carriers; Akamai correlates IP geo |
| AC | `ca` | Canadian carrier |
| BA | `gb` | UK carrier |
| AF | `fr` | French carrier |
| KL | `nl` | Dutch carrier |
| LH | `de` | German carrier |
| TK | `tr` | Turkish carrier |
| NH | `jp` | Japanese carrier |
| CX | `hk` | Hong Kong carrier |
| AV | `co` | Colombian carrier |
| AM | `mx` | Mexican carrier |
| AD | `br` | Brazilian carrier |
| CM | `pa` | Panamanian carrier |
| EK | `ae` | UAE carrier |
| ET | `et` | Ethiopian carrier |
| EY | `ae` | UAE carrier |
| SK | `se` | Swedish carrier |
| AY | `fi` | Finnish carrier |
| QF, VA | `au` | Australian carriers |
| QR | `qa` | Qatari carrier |
| SV | `sa` | Saudi carrier |
| SQ | `sg` | Singaporean carrier |
| G3 | `br` | Brazilian carrier |
| VS | `gb` | UK carrier (works via httpx, no proxy needed today) |
