"""JetBlue TrueBlue award search plugin.

REAL SCRAPE ACTIVE: Posts to JetBlue's public best-fares BFF endpoint.
Single HTTPS POST returns a whole month of award pricing — no session
warm-up, no cookies, no JS challenge.

Endpoint:
  POST https://jbrest.jetblue.com/bff/bff-service/bestFares/
    body (flat JSON):
      {"origin": "JFK", "destination": "LAX", "month": "AUGUST 2026",
       "fareType": "POINTS", "tripType": "ONE_WAY", "adult": 1,
       "currency": "USD"}
    → 200 application/json:
      {"currencyCode": "USD",
       "outboundFares": [
         {"date": "2026-08-01", "amount": 20800, "tax": 5.60, "seats": 2},
         ...one entry per day in the month...]}

`fareType: POINTS` is the award toggle (`LOWEST` would return cash). The
`amount` is the lowest TrueBlue points price for that date, `tax` is the
USD taxes/fees, `seats` is the award seat count at that price.

History: the awardwiz-era endpoint `jbrest.jetblue.com/lfs-rwb/outboundLFS`
is dead (returns "default backend - 404" — no longer routed). JetBlue's
`/booking/*` Angular SPA is now behind a Fastly client challenge, but the
`bff-service` REST host is wide open — verified 2026-05-20 with a plain
httpx POST returning 200 from the sandbox with NO proxy. So this is a
genuine T0 target.

The best-fares endpoint is a per-month award CALENDAR — it returns the
lowest economy ("Blue") points price per day, not a flight list. It does
not break out Mint (business). So every row this plugin emits is a Y-cabin
calendar rollup with no flight number / segment detail, mirroring the VS
Flying Club plugin's shape.

Returns one NormalizedResult for the requested date when JetBlue shows
award availability there. Returns [] on any failure (4xx/5xx, JSON parse
error, no availability, no JetBlue service on the route).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from common.scrape_client import scrape_client
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "B6_TRUEBLUE"
PROGRAM_NAME = "JetBlue TrueBlue"

ENDPOINT = "https://jbrest.jetblue.com/bff/bff-service/bestFares/"
MONTH_NAMES = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
]


def _iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _build_body(origin: str, dest: str, date: str) -> dict[str, Any]:
    """JetBlue's best-fares request is per-MONTH — the endpoint returns
    every day of the month named by `month`, so we pass the month of the
    requested date and pluck the matching day out of the response."""
    d = datetime.strptime(date, "%Y-%m-%d")
    return {
        "origin": origin,
        "destination": dest,
        "month": f"{MONTH_NAMES[d.month - 1]} {d.year}",
        "fareType": "POINTS",   # POINTS = award; LOWEST would be cash
        "tripType": "ONE_WAY",
        "adult": 1,
        "currency": "USD",
    }


def _parse(
    payload: dict[str, Any],
    target_date: str,
    origin: str,
    dest: str,
) -> NormalizedResult | None:
    """Pull the requested day out of JetBlue's best-fares calendar.

    Response shape:
      {"currencyCode": "USD",
       "outboundFares": [{"date": "2026-08-15", "amount": 16300,
                          "tax": 5.60, "seats": 6}, ...]}

    `amount` is TrueBlue points (award price); `tax` is USD taxes/fees;
    `seats` is the count of award seats at that price. A day with no award
    availability is either absent from `outboundFares` or carries a falsy
    `amount`/`seats` — both are treated as "no result"."""
    fares = (payload or {}).get("outboundFares") or []
    day = next((f for f in fares if f.get("date") == target_date), None)
    if not day:
        return None

    miles = int(day.get("amount") or 0)
    seats = int(day.get("seats") or 0)
    if miles <= 0 or seats <= 0:
        return None

    taxes_usd = int(round(float(day.get("tax") or 0)))

    # TrueBlue best-fares only surfaces the lowest economy ("Blue") points
    # price — no Mint/business breakout — so every row is a Y-cabin price.
    cabin_prices = [
        CabinPrice(
            cabin="Y",
            seats_remaining=seats,
            miles_per_pax=miles,
            surcharge_usd_per_pax=0,   # TrueBlue awards carry no YQ
            taxes_usd_per_pax=taxes_usd,
        )
    ]

    now = datetime.now(timezone.utc)
    return NormalizedResult(
        program_id=PROGRAM_ID,
        program_name=PROGRAM_NAME,
        origin_iata=origin,
        dest_iata=dest,
        depart_date=target_date,
        arrive_date=target_date,   # calendar endpoint returns no arrive date
        total_duration_min=0,      # no segment/timing data from this endpoint
        num_segments=1,
        segments=[
            ResultSegment(
                segment_order=0,
                operating_airline_iata="B6",
                marketing_airline_iata="B6",
                flight_number="CAL",   # calendar rollup — no flight number
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
        confidence_score=80,   # clean public JSON API — real-scrape "High"
        observed_at=_iso_utc(now),
        last_seen_at=_iso_utc(now),
    )


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    try:
        body = _build_body(origin, dest, date)
    except ValueError as exc:  # bad date string
        log.warning("B6 bad date %r: %s", date, exc)
        return []

    async with scrape_client(timeout_s=20.0) as client:
        try:
            r = await client.post(
                ENDPOINT,
                json=body,
                headers={
                    "Origin": "https://www.jetblue.com",
                    "Referer": "https://www.jetblue.com/booking/flights",
                },
            )
            if r.status_code != 200:
                # 400 here usually means "no JetBlue service on this route"
                # (bad airport pair) — log the body head so we can tell a
                # routing rejection from a real outage.
                try:
                    snippet = (r.text or "")[:300]
                except Exception:  # noqa: BLE001
                    snippet = ""
                log.warning(
                    "B6 best-fares returned %s; body[:300]=%s",
                    r.status_code, snippet,
                )
                return []
            payload = r.json()
            if not isinstance(payload, dict):
                log.warning("B6 best-fares returned non-dict payload")
                return []
        except Exception as exc:  # noqa: BLE001
            log.warning("B6 scrape failed: %s", exc)
            return []

    result = _parse(payload, date, origin, dest)
    return [result] if result else []


search = _scrape_real
