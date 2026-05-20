"""British Airways Avios award search plugin — auth_required (T5' path).

Phase-1 transport investigation (2026-05-20). The prior transport
(Patchright + BD Browser API + Executive Club login) is Akamai-flagged
for ba.com, so the search silently returned `[]`. This module was slated
for a Bright Data Web Unlocker rewrite — but the investigation below
shows BA Avios award search **cannot be scraped anonymously**, so no WU
transport can make it work. The plugin is left as an honest
`auth_required` stub.

=============================================================================
INVESTIGATION FINDINGS (2026-05-20, all via `/diag/wu_probe`, format=json):

  * `GET britishairways.com/travel/flightfinderhome/public/en_gb`
      → 200, 57 KB. A real page — BA's classic "Reward Flight Finder"
      guided-flow entry (`dataLayer.pagename = "PLANREDEMPTIONJOURNEY"`).
      WU clears BA's Akamai for the page GET.
  * `GET .../travel/redeem/execclub/_gf/en_gb?from=...&to=...&depDate=...`
      → 200, 51 KB modern React redemption SPA. WU renders the shell, but
      (like every SPA) WU's `format=json` HTTP API returns the
      un-hydrated shell — it does NOT wait for the SPA's availability XHR.
  * `GET .../travel/flightfinderresults/public/en_gb?depLoc=...&arrLoc=...`
      → 200, 108 KB, but the body carries
      `<meta http-equiv="refresh" content="5;url=/main/home">` — BA's
      **no-valid-session bounce**. The classic *public* RFF results path
      now redirects to home without a logged-in session.
  * `GET api.ba.com/rest-v1/v1/rewardFlights` → 502 (`596 status code`) —
      the guessed iOS-app API host/path does not resolve.
  * `GET britishairways.com/api/travel/redemption/flights` → BA's 9 KB
    catch-all "Information Page" (the endpoint does not exist).

CONCLUSION — auth_required (matches Agent 5's research):
  British Airways Avios award search requires a logged-in **British
  Airways Club (Executive Club)** session to return Avios prices +
  availability. The modern `_gf/en_gb` redemption SPA needs that session;
  the legacy *public* Reward Flight Finder results path now bounces to
  `/main/home` when there is no session. Bright Data Web Unlocker
  bypasses BA's Akamai bot defense, but **WU cannot supply a logged-in
  account session** — it is a stateless single-shot fetch, not an
  authenticated browser.

  This is NOT a WU/transport bug and NOT something a code change fixes.
  BA Avios belongs to the **T5' user-auth-capture** path (a sibling
  workstream is building it): the user logs into their BA Club account
  in a cockpit-streamed browser, the worker captures + replays the
  session cookies. Per the scraping briefing, a broken plugin must NOT
  be forced — so `search()` here returns `[]` with verdict
  `auth_required` until the T5' session-injection path lands.

  When T5' delivers a logged-in BA cookie jar, this plugin gains a real
  transport: WU-POST the redemption availability XHR (or render the
  `_gf` SPA) with the injected `BIGipServer*` + `JSESSIONID` + auth
  cookies forwarded as a `Cookie:` header. `_parse()` below is kept
  intact and ready for that day so only the transport needs wiring.
=============================================================================

Defensive contract: `search()` never raises — it returns `[]` and records
a verdict in `LAST_RUN_DIAG`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "BA_AVIOS"
PROGRAM_NAME = "British Airways Avios"

# Reference URLs (kept for the T5' transport that will replace this stub).
RFF_HOME_URL = "https://www.britishairways.com/travel/flightfinderhome/public/en_gb"
REDEEM_SPA_URL = "https://www.britishairways.com/travel/redeem/execclub/_gf/en_gb"

# Module-level diagnostic state — exposed for the parent's consolidated
# deploy/test. Forensic-detail by design (CLAUDE.md scraper log discipline).
LAST_RUN_DIAG: dict[str, Any] = {}


def _cabin_from_ba(code: str) -> str | None:
    """Map a BA cabin/booking letter to our cabin enum.

    BA's RFF uses M (economy), W (premium economy), C/J (business),
    F/A (first). Kept for the T5' transport's parse step.
    """
    return {
        "M": "Y", "Y": "Y",
        "W": "W",
        "C": "J", "J": "J",
        "F": "F", "A": "F",
    }.get((code or "").upper())


def _parse(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Parse a BA redemption-availability response into NormalizedResult[].

    Kept intact and ready for the T5' (logged-in) transport — BA's
    availability XHR returns a per-flight list with per-cabin Avios +
    taxes/fees. Robust to missing keys: any flight that fails to parse is
    skipped, not fatal. Not exercised by the current `auth_required` stub.
    """
    results: list[NormalizedResult] = []
    flights = payload.get("flights") or payload.get("itineraries") or payload.get("out") or []
    for f in flights[:6]:
        try:
            cabin_prices: list[CabinPrice] = []
            for cabin_key, miles_obj in (f.get("prices") or f.get("fares") or {}).items():
                cabin = _cabin_from_ba(cabin_key)
                miles = (
                    miles_obj if isinstance(miles_obj, int)
                    else (miles_obj.get("miles") if isinstance(miles_obj, dict) else 0)
                )
                if not cabin or not miles:
                    continue
                taxes = 0
                if isinstance(miles_obj, dict):
                    taxes = int(round(float(miles_obj.get("tax") or 0)))
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin,  # type: ignore[arg-type]
                        seats_remaining=int(f.get("bs") or f.get("seatsRemaining") or 0),
                        miles_per_pax=int(miles),
                        surcharge_usd_per_pax=175,  # BA YQ typical per segment
                        taxes_usd_per_pax=taxes,
                    )
                )
            if not cabin_prices:
                continue
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            results.append(
                NormalizedResult(
                    program_id=PROGRAM_ID,
                    program_name=PROGRAM_NAME,
                    origin_iata=origin,
                    dest_iata=dest,
                    depart_date=date,
                    arrive_date=date,
                    total_duration_min=0,
                    num_segments=1,
                    segments=[
                        ResultSegment(
                            segment_order=0,
                            operating_airline_iata="BA",
                            marketing_airline_iata="BA",
                            flight_number=str(f.get("flightNumber") or ""),
                            origin_iata=origin,
                            dest_iata=dest,
                            depart_at=f.get("departureDateTime") or f"{date}T00:00:00Z",
                            arrive_at=f.get("arrivalDateTime") or f"{date}T00:00:00Z",
                            aircraft_icao=None,
                            segment_cabin=None,
                            fare_class=None,
                        )
                    ],
                    cabin_prices=cabin_prices,
                    confidence_score=68,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("BA flight parse error: %s", exc)
            continue
    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",  # noqa: ARG001 — keep signature parity
) -> list[NormalizedResult]:
    """BA Avios award search — auth_required, returns `[]`.

    British Airways Avios award search requires a logged-in BA Club
    session (Agent 5 research + the 2026-05-20 `/diag/wu_probe`
    investigation in this module's docstring). Bright Data Web Unlocker
    clears BA's Akamai but cannot supply a logged-in account, so no WU
    transport can make this plugin return real rows. BA Avios is routed
    to the T5' user-auth-capture path instead.

    Records verdict `auth_required` in `LAST_RUN_DIAG` and returns `[]`.
    """
    global LAST_RUN_DIAG
    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transport": "none",
        "origin": origin,
        "dest": dest,
        "date": date,
        "last_verdict": "auth_required",
        "row_count": 0,
        "note": (
            "BA Avios award search requires a logged-in British Airways "
            "Club session. WU bypasses Akamai but cannot supply a "
            "logged-in account. The legacy public Reward Flight Finder "
            "results path now bounces to /main/home without a session "
            "(verified via /diag/wu_probe 2026-05-20). Routed to the T5' "
            "user-auth-capture path; no WU transport applies."
        ),
        "reference_urls": {
            "rff_home": RFF_HOME_URL,
            "redeem_spa": REDEEM_SPA_URL,
        },
    }
    print(
        f"BA: ===== {origin}->{dest} {date} — auth_required, "
        f"returning [] (T5' path) =====",
        flush=True,
    )
    return []


search = _scrape_real
