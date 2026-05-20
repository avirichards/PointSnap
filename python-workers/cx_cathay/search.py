"""Cathay / Asia Miles award search plugin — AUTH-REQUIRED, returns [].

=============================================================================
STATUS (2026-05-21): Cathay award search is LOGIN-GATED. There is no
anonymous award-availability path, so neither Bright Data Web Unlocker
pattern (2-step API POST, or in-page SPA render) can produce rows. The plugin
returns `[]` cleanly with `LAST_RUN_DIAG["verdict"] == "auth_required"`.

Cathay belongs on the **T5' user-auth-capture path**, not the WU-grind path.

Evidence (verified via `/diag/wu_probe`, 2026-05-21):

  * `GET https://www.cathaypacific.com/cx/en_US/book-a-trip/redeem-flight-awards.html`
    via WU → **404** — the body is a Next.js error page (`/error/_next/...`).
    The redeem-flight-awards.html URL the old plugin used is stale/moved.
    WU clears Akamai fine here (the Set-Cookie jar carries the full
    `bm_*` + `_abck` + `ak_bmsc` set) — the 404 is Cathay's, not WU's.

  * `GET https://book.cathaypacific.com/CathayPacificAwardV3/` via WU → 200,
    a 4.5 KB "Index file" with an mPulse/boomerang beacon and an Imperva
    bot-challenge script (`<script src="/slow-on-What-witnes-...">`).
    This host is the legacy CathayPacificAwardV3 award-booking engine and
    is double-protected: Akamai `bm_*` cookies AND Imperva/Incapsula
    (`nlbi_*`, `visid_incap_*`, `incap_ses_*`).

  * `POST https://book.cathaypacific.com/CathayPacificAwardV3/dyn/air/booking/availability`
    via WU → `x-brd-error: captcha or protection page found` /
    `reject_block`. The availability endpoint is Imperva-walled on POST and
    WU cannot clear the challenge for it.

Why login is unavoidable (cross-confirmed):
  * Agent 5 (auth-viability research): "CX Asia Miles — must sign in at
    cathaypacific.com to redeem flight awards." MFA = SMS OTP.
  * The CathayPacificAwardV3 `availability` endpoint is session-bound: it
    needs a per-session `TAB_ID` token that is only exposed in the page JS
    globals of the *logged-in* redeem page, and the POST must carry the
    logged-in cookie jar (`credentials: 'include'`).
  * The prior plugin (and the flightplan-tool `cx` engine it was ported
    from) both perform a credentialed login before any search.

There is no anonymous Cathay award-availability API to point WU at. The
correct path is T5' — capture a logged-in Asia Miles session in the cockpit,
then replay it. When that path exists, `_parse()` below is kept intact and
correct so it can be reused as the response parser.
=============================================================================

Defensive contract: `search()` never raises — it returns `[]` and records
`LAST_RUN_DIAG["verdict"] == "auth_required"`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "CX_CATHAY"
PROGRAM_NAME = "Cathay Asia Miles"

# The legacy award-booking engine + its session-bound availability endpoint.
# Recorded here for the future T5' auth-capture implementation; not called
# by this WU-grind plugin (the endpoint is Imperva-walled + login-gated).
AWARD_ENGINE_URL = "https://book.cathaypacific.com/CathayPacificAwardV3/"
AVAILABILITY_API = (
    "https://book.cathaypacific.com/CathayPacificAwardV3/dyn/air/booking/availability"
)

# Module-level forensic state (CLAUDE.md scraper-log discipline). No
# `/diag/cx_last` route is wired in serve.py — this dict is still the
# single source of truth for "what did the last CX run do".
LAST_RUN_DIAG: dict[str, Any] = {
    "verdict": "auth_required",
    "note": (
        "Cathay award search is login-gated; no anonymous availability API. "
        "Legacy CathayPacificAwardV3 /availability endpoint is Imperva-walled "
        "on POST and needs a logged-in per-session TAB_ID. Route to T5' "
        "user-auth-capture. See module docstring for /diag/wu_probe evidence."
    ),
}


def _cabin_from_cx(code: str) -> str | None:
    """Map a Cathay cabin/booking-class code to our cabin enum."""
    c = (code or "").upper()
    if c.startswith("F"):
        return "F"
    if c.startswith("C"):
        return "J"
    if c.startswith("W"):
        return "W"
    if c.startswith("Y"):
        return "Y"
    return None


def _parse(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Parse a Cathay availability response into NormalizedResult[].

    Kept intact and correct for the future T5' auth-capture path — when a
    logged-in Asia Miles session is available, this is the response parser.
    It is not called on the anonymous WU-grind path (which returns []).
    """
    results: list[NormalizedResult] = []
    for it in (payload.get("itinerary") or payload.get("itineraries") or [])[:6]:
        try:
            segments_raw = it.get("segments") or it.get("segment") or []
            segments: list[ResultSegment] = []
            for i, seg in enumerate(segments_raw):
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=seg.get("operatingCarrier")
                        or seg.get("marketingCarrier")
                        or "CX",
                        marketing_airline_iata=seg.get("marketingCarrier") or "CX",
                        flight_number=str(seg.get("flightNumber") or ""),
                        origin_iata=seg.get("origin") or origin,
                        dest_iata=seg.get("destination") or dest,
                        depart_at=seg.get("departureDateTime") or f"{date}T00:00:00Z",
                        arrive_at=seg.get("arrivalDateTime") or f"{date}T00:00:00Z",
                        aircraft_icao=seg.get("aircraft"),
                        segment_cabin=None,
                        fare_class=None,
                    )
                )

            cabin_prices: list[CabinPrice] = []
            for fare in it.get("fares") or it.get("offers") or []:
                cabin = _cabin_from_cx(fare.get("cabinClass") or fare.get("cabin") or "")
                if not cabin:
                    continue
                miles = int(fare.get("miles") or fare.get("milesPerPax") or 0)
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin,  # type: ignore[arg-type]
                        seats_remaining=int(fare.get("seatsRemaining") or 0),
                        miles_per_pax=miles,
                        surcharge_usd_per_pax=int(
                            round(float(fare.get("surcharge") or fare.get("yq") or 0))
                        ),
                        taxes_usd_per_pax=int(round(float(fare.get("taxes") or 0))),
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
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=cabin_prices,
                    confidence_score=76,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("CX itinerary parse error: %s", exc)
            continue
    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",  # noqa: ARG001 — keep signature parity
) -> list[NormalizedResult]:
    """Cathay award search — login-gated, no anonymous path.

    Returns `[]` immediately and records `verdict="auth_required"` in
    `LAST_RUN_DIAG`. Cathay belongs on the T5' user-auth-capture path; see
    the module docstring for the `/diag/wu_probe` evidence behind this.
    Never raises.
    """
    global LAST_RUN_DIAG
    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "origin": origin,
        "dest": dest,
        "date": date,
        "transport": "none — auth_required",
        "verdict": "auth_required",
        "award_engine_url": AWARD_ENGINE_URL,
        "availability_api": AVAILABILITY_API,
        "note": (
            "Cathay award search requires a logged-in Asia Miles session "
            "(SMS-OTP MFA). The CathayPacificAwardV3 /availability endpoint "
            "is Imperva-walled on POST and session-bound (per-session TAB_ID "
            "from the logged-in redeem page). No anonymous availability API "
            "exists, so the BD Web Unlocker cannot grind it. Route to the "
            "T5' user-auth-capture flow."
        ),
        "row_count": 0,
    }
    print(
        f"CX: {origin}->{dest} {date} — award search is login-gated; "
        f"returning [] (auth_required, route to T5').",
        flush=True,
    )
    return []


search = _scrape_real
