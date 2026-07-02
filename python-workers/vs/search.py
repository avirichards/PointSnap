"""Virgin Atlantic Flying Club award search plugin.

REAL SCRAPE ACTIVE: Posts to virginatlantic.com's public reward-seat-
checker endpoint. Flow:
  1. POST /travelplus/reward-seat-checker-api/ with the month/route body.
     Returns HTTP 303 with a Location header.
  2. GET the Location → HTTP 200 application/json with calendar data.

No auth required. Akamai Bot Manager is in front but doesn't enforce JS
sensor validation on this endpoint (verified live 2026-05-17 by research
agent). Plain httpx with Chrome User-Agent works today; curl_cffi with
chrome131 impersonation is the next defensive step if Akamai tightens.

Returns one NormalizedResult per (date, cabin) for which the calendar
shows availability (cabinPointsValue > 0). VS-operated only — Delta /
ANA / SkyTeam partner segments aren't returned by this endpoint.

Returns [] if the scrape fails or the route has no availability.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from common.scrape_client import scrape_client
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "VS_FLYING_CLUB"
PROGRAM_NAME = "Virgin Atlantic"

ENDPOINT = "https://www.virginatlantic.com/travelplus/reward-seat-checker-api/"
MONTH_NAMES = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
]

# Cabin map from VS's calendar API → our Y/W/J enum.
VS_CABIN_MAP = {
    "awardEconomy": "Y",
    "awardComfortPlusPremiumEconomy": "W",
    "awardBusiness": "J",
}


def _iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _build_body(origin: str, dest: str, date: str) -> dict[str, Any]:
    d = datetime.strptime(date, "%Y-%m-%d")
    return {
        "slice": {
            "origin": origin,
            "destination": dest,
            "departure": d.replace(day=1).strftime("%Y-%m-%d"),
        },
        "passengers": ["ADULT"],
        "permittedCarriers": ["VS"],
        "years": [d.year],
        "months": [MONTH_NAMES[d.month - 1]],
    }


def _extract_for_date(
    payload: list[dict[str, Any]],
    target_date: str,
    origin: str,
    dest: str,
) -> NormalizedResult | None:
    """VS calendar response shape:
      payload = [
        {
          "date": "2026-08-01",     # ALWAYS 1st of month — top level is per-MONTH
          "month": "AUGUST",
          ...,
          "pointsDays": [           # one entry PER DAY in the month
            {"date": "2026-08-01", "seats": {...}, "minPrice": ..., ...},
            {"date": "2026-08-02", "seats": {...}, ...},
            ...
          ]
        }
      ]
    Walk pointsDays to find the day matching target_date."""
    if not payload:
        return None
    month_entry = payload[0]
    points_days = month_entry.get("pointsDays") or []
    day = next((d for d in points_days if d.get("date") == target_date), None)
    if not day:
        return None

    cabin_prices: list[CabinPrice] = []
    surcharge_usd = int(round(float(day.get("minPrice") or 0) * 1.25))  # GBP→USD rough

    for vs_key, cabin_code in VS_CABIN_MAP.items():
        cabin_data = (day.get("seats") or {}).get(vs_key)
        if not cabin_data:
            continue
        miles = cabin_data.get("cabinPointsValue") or 0
        if miles <= 0:
            continue
        seats = cabin_data.get("cabinClassSeatCount") or 0
        cabin_prices.append(
            CabinPrice(
                cabin=cabin_code,  # type: ignore[arg-type]
                seats_remaining=int(seats),
                miles_per_pax=int(miles),
                surcharge_usd_per_pax=surcharge_usd,
                taxes_usd_per_pax=0,
            )
        )

    if not cabin_prices:
        return None

    now = datetime.now(timezone.utc)
    return NormalizedResult(
        program_id=PROGRAM_ID,
        program_name=PROGRAM_NAME,
        origin_iata=origin,
        dest_iata=dest,
        depart_date=target_date,
        arrive_date=target_date,  # calendar endpoint doesn't return arrive_date
        total_duration_min=0,  # no segment data from this endpoint
        num_segments=1,
        segments=[
            ResultSegment(
                segment_order=0,
                operating_airline_iata="VS",
                marketing_airline_iata="VS",
                flight_number="",  # month-calendar rollup — no specific flight number
                origin_iata=origin,
                dest_iata=dest,
                depart_at=f"{target_date}T12:00:00Z",
                arrive_at=f"{target_date}T12:00:00Z",
                aircraft_icao=None,
                segment_cabin=None,
                fare_class=None,
            )
        ],
        cabin_prices=cabin_prices,
        confidence_score=78,  # real-scrape rows start at "High"
        observed_at=_iso_utc(now),
        last_seen_at=_iso_utc(now),
    )


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    body = _build_body(origin, dest, date)
    async with scrape_client(timeout_s=20.0) as client:
        try:
            # Step 1: POST → 303 with Location
            r1 = await client.post(
                ENDPOINT,
                json=body,
                headers={
                    "Origin": "https://www.virginatlantic.com",
                    "Referer": (
                        "https://www.virginatlantic.com/reward-flight-finder/"
                        f"results/month?origin={origin}&destination={dest}"
                    ),
                },
                follow_redirects=False,
            )
            if r1.status_code != 303 or not r1.headers.get("location"):
                # Log the response body on non-303 so we can see what
                # Akamai / the API actually returned (per VS agent's
                # debugging note).
                try:
                    snippet = (r1.text or "")[:300]
                except Exception:
                    snippet = ""
                log.warning(
                    "VS step1 unexpected status %s; body[:300]=%s",
                    r1.status_code, snippet,
                )
                return []
            location = r1.headers["location"]
            if not location.startswith("http"):
                location = "https://www.virginatlantic.com" + location

            # Step 2: GET → 200 JSON
            r2 = await client.get(
                location,
                headers={"Origin": "https://www.virginatlantic.com"},
            )
            if r2.status_code != 200:
                log.warning("VS step2 returned %s", r2.status_code)
                return []
            payload = r2.json()
            if not isinstance(payload, list):
                log.warning("VS step2 returned non-list payload")
                return []
        except Exception as exc:  # noqa: BLE001
            log.warning("VS scrape failed: %s", exc)
            return []

    result = _extract_for_date(payload, date, origin, dest)
    return [result] if result else []


search = _scrape_real
