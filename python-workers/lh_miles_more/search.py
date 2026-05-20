"""Lufthansa Miles & More award search plugin — Bright Data Web Unlocker.

Phase 1 transport rewrite (2026-05-20). The prior transport (Patchright /
BD Browser API) was Akamai-flagged and silently returned `[]`. This module
replaces it with the Bright Data **Web Unlocker** (WU) transport and
records a forensic trace.

Note: Miles & More moved its bot defense to **Cloudflare Turnstile** (per
Agent 3's bot-defense profile — `__cf_bm`, `cf-ray`, CSP locked to
`challenges.cloudflare.com`), NOT Akamai like most carriers. WU still
handles it — the homepage renders cleanly via WU.

=============================================================================
STATUS (2026-05-20): Miles & More award search is `auth_required`. WU
bypasses the Cloudflare bot defense fine but CANNOT supply the logged-in
session the award search needs. The plugin returns `[]` with verdict
`auth_required` on every run — Miles & More belongs to the T5' user-auth
path, not to a WU scrape.

Investigation (all via `/diag/wu_probe` + direct WU calls, ~8 probes):

  * `GET https://www.miles-and-more.com/de/en.html` → WU 200, 268 KB real
    homepage (clean content — NO Cloudflare challenge page). WU clears
    Miles & More's Cloudflare Turnstile fine.
  * `GET https://www.lufthansa.com/us/en/flight-search` → WU 200, 71 KB.
    This is the Lufthansa "digital hangar" booking SPA shell (an AEM-hosted
    app, `maui-design-system` + `digitalhangar` chunks). It only does a
    *cash* flight search anonymously.
  * `GET https://www.lufthansa.com/us/en/offers?...&awardBooking=true`
    (the offers deep-link, Pattern B candidate) → WU 200 but only the
    47 KB SPA shell — no `award`, no `offer-card`, no `flight-card`, no
    `price` content. The digital-hangar app renders results client-side
    after JS bootstrap; WU's `format=json` returns the shell before the
    offers XHR resolves.
  * The flight-search SPA references the offers API host
    `searching.lufthansa.com/esearch/api/v1/...`, but that host **does not
    resolve through Bright Data's proxy** (`proxy_error` /
    `Could not resolve host searching.lufthansa.com`). So WU cannot reach
    the offers API directly (Pattern A unavailable).
  * The Lufthansa pages embed Akamai sensor.js and reference `TravelID`
    (the LH/SK/LX/OS single-sign-on). Switching the booking flow to
    *Miles* (award) mode requires a logged-in MyTravelID session.

Agent 5 (auth-viability research) independently confirms: Miles & More
award search requires login **and a 7,000-mile account balance** to even
*search* — the hardest login wall in the program set. T5' priority HIGH.

CONCLUSION: there is no anonymous, server-rendered Miles & More award
endpoint for WU to reach. The award search is an authenticated
digital-hangar SPA gated behind MyTravelID + a mileage-balance floor.
This plugin stays wired so `/diag/run_plugin` captures a forensic trace,
and returns `[]` (verdict `auth_required`) until the T5' user-auth path
supplies a logged-in cookie jar.
=============================================================================

Defensive contract: `search()` never raises — every failure path returns
`[]` and records a verdict in `LAST_RUN_DIAG`.

No new env vars beyond `BRIGHTDATA_WU_TOKEN` / `BRIGHTDATA_WU_ZONE`
(both read by `common/bd_wu.py`).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from common.bd_wu import wu_request_json
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "LH_MILES_MORE"
PROGRAM_NAME = "Miles & More"

# The Lufthansa digital-hangar flight-search SPA. WU renders the shell here
# (200) — only a cash search is available anonymously; the Miles (award)
# toggle needs a logged-in MyTravelID session. Probed as a liveness signal.
FLIGHT_SEARCH_URL = "https://www.lufthansa.com/us/en/flight-search"

# Module-level diagnostic state — exposed via `/diag/run_plugin`. Forensic
# by design (CLAUDE.md scraper-log discipline).
LAST_RUN_DIAG: dict[str, Any] = {"attempts": []}


def _parse(payload: Any, origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Parse a Miles & More award response into NormalizedResult[].

    Kept intact for the day the T5' user-auth path supplies a logged-in
    session and a real award payload reaches this function. M&M award
    offers are a list under `flights` / `offers` / `itineraries`, each
    carrying per-cabin miles + taxes. Robust to missing keys: any offer
    that fails to parse is skipped, not fatal.
    """
    results: list[NormalizedResult] = []
    flights = (
        payload.get("flights") or payload.get("offers") or payload.get("itineraries") or []
    ) if isinstance(payload, dict) else []
    for f in flights[:6]:
        try:
            cabin_prices: list[CabinPrice] = []
            for cab_key, cab in (
                ("economy", "Y"),
                ("premiumEconomy", "W"),
                ("business", "J"),
                ("first", "F"),
            ):
                price_obj = (f.get("prices") or f.get("cabins") or {}).get(cab_key) or {}
                miles = price_obj.get("miles") if isinstance(price_obj, dict) else price_obj
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cab,  # type: ignore[arg-type]
                        seats_remaining=0,
                        miles_per_pax=int(miles),
                        surcharge_usd_per_pax=850 if cab == "F" else 0,  # LH F YQ typical
                        taxes_usd_per_pax=(
                            int(round(float(price_obj.get("taxes") or 0)))
                            if isinstance(price_obj, dict)
                            else 0
                        ),
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
                            operating_airline_iata=f.get("carrier") or "LH",
                            marketing_airline_iata="LH",
                            flight_number=str(f.get("flightNumber") or ""),
                            origin_iata=origin,
                            dest_iata=dest,
                            depart_at=f"{date}T00:00:00Z",
                            arrive_at=f"{date}T00:00:00Z",
                            aircraft_icao=None,
                            segment_cabin=None,
                            fare_class=None,
                        )
                    ],
                    cabin_prices=cabin_prices,
                    confidence_score=22,  # heavy phantom; keep "Low"
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("LH parse error: %s", exc)
            continue
    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",  # noqa: ARG001 — keep signature parity
) -> list[NormalizedResult]:
    """Miles & More award search — `auth_required`, returns `[]`.

    See the module docstring for the full investigation. In short: Miles &
    More's award search is an authenticated digital-hangar SPA. WU clears
    the Cloudflare bot defense (the flight-search SPA renders 200) but
    cannot run the SPA to completion, fire its offers XHR, or supply the
    logged-in MyTravelID session that award (Miles) mode requires — and
    Agent 5 confirms a 7,000-mile balance floor on top. The offers API
    host (`searching.lufthansa.com`) does not even resolve through BD's
    proxy. This is a T5' user-auth-path program.

    This function still does one WU GET of the flight-search SPA so
    `LAST_RUN_DIAG` records whether WU currently reaches the host (vs. a
    transport regression), then returns `[]` with verdict `auth_required`.

    Verdict codes recorded in `LAST_RUN_DIAG["last_verdict"]`:
      auth_required — expected terminal state: Miles & More needs a
                      logged-in MyTravelID session (+ a 7,000-mile balance)
                      WU cannot supply
      http_error    — network/timeout error reaching api.brightdata.com
      crash         — unhandled exception (programmer error)
    """
    global LAST_RUN_DIAG
    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transport": "bd_web_unlocker",
        "origin": origin,
        "dest": dest,
        "date": date,
        "flight_search_url": FLIGHT_SEARCH_URL,
        "note": (
            "Miles & More award search is an authenticated digital-hangar "
            "SPA. WU bypasses the Cloudflare bot defense but cannot supply "
            "the logged-in MyTravelID session award mode needs (Agent 5: "
            "also a 7,000-mile balance floor), and the offers API host "
            "does not resolve through BD's proxy. Routed to the T5' "
            "user-auth path."
        ),
        "attempts": [],
    }
    print(
        f"LH: ===== search start {origin}->{dest} {date} (auth_required) =====",
        flush=True,
    )

    attempt: dict[str, Any] = {"stage": "flight_search_probe", "url": FLIGHT_SEARCH_URL}
    try:
        status, envelope = await wu_request_json(FLIGHT_SEARCH_URL, method="GET")
        attempt["wu_http_status"] = status
        if isinstance(envelope, dict):
            attempt["target_status"] = (
                envelope.get("status_code") or envelope.get("status")
            )
            body = envelope.get("body")
            if isinstance(body, str):
                attempt["body_len"] = len(body)
                # The digital-hangar SPA shell — not an award payload.
                attempt["has_travelid_ref"] = "TravelID" in body
            hdrs = envelope.get("headers") or envelope.get("response_headers") or {}
            if isinstance(hdrs, dict):
                attempt["x_brd_error"] = hdrs.get("x-brd-error") or hdrs.get("X-Brd-Error")
    except httpx.HTTPError as exc:
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"LH: flight-search probe httpx error: {err}", flush=True)
        attempt.update(stage="probe_http_error", error=err)
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "http_error"
        LAST_RUN_DIAG["row_count"] = 0
        return []
    except Exception as exc:  # noqa: BLE001
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"LH: flight-search probe crash: {err}", flush=True)
        attempt.update(stage="probe_crash", error=err)
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "crash"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    attempt["verdict"] = "auth_required"
    LAST_RUN_DIAG["attempts"].append(attempt)
    LAST_RUN_DIAG["last_verdict"] = "auth_required"
    LAST_RUN_DIAG["row_count"] = 0
    print(
        f"LH: flight-search probe → wu={attempt.get('wu_http_status')} "
        f"target={attempt.get('target_status')} — "
        f"auth_required, returning [] (T5' user-auth path)",
        flush=True,
    )
    return []


search = _scrape_real
