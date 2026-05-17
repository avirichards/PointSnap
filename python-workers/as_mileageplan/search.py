"""Alaska Mileage Plan (Atmos Rewards) award search plugin.

REAL SCRAPE ACTIVE: Alaska's modern stack is a SvelteKit SSR app. The
full award-search JSON is inlined into the HTML response as a
__sveltekit_*.resolve(2, () => [{departureStation:...}]) script literal.
NO separate XHR fetch is needed — one HTTPS GET returns everything.

Endpoint:
  GET https://www.alaskaair.com/search/results
    ?O={origin}&D={dest}&OD={YYYY-MM-DD}
    &A=1&C=0&L=0&RT=false
    &ShoppingMethod=onlineaward&awardType=MilesOnly

No auth required for partner-award browsing. Anti-bot posture is light —
plain httpx + Chrome User-Agent through IPRoyal residential typically
returns 200 in ~1s. Cathay and LATAM are silently excluded from the
online surface (call to book per Alaska's published policy).

Falls back to canonical seed data when:
  - GET 4xx/5xx
  - Regex doesn't match the inlined payload (Alaska changed the SSR
    runtime; this happens occasionally)
  - JSON5-style payload doesn't parse
  - Empty results
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

try:
    import json5  # robust parser for the SvelteKit unquoted-key payload
    _HAS_JSON5 = True
except ImportError:  # pragma: no cover — fall back to regex normalizer
    _HAS_JSON5 = False

from common.plugin_wrapper import with_canonical_fallback
from common.scrape_client import scrape_client
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "AS_MILEAGEPLAN"
PROGRAM_NAME = "Alaska Mileage Plan"

SEARCH_URL = "https://www.alaskaair.com/search/results"

# Match the SvelteKit hydration literal. Alaska's runtime suffix changes
# (e.g. `__sveltekit_x7m9k0`), so we use a flexible pattern.
PAYLOAD_PATTERN = re.compile(
    r"__sveltekit_[a-z0-9_]+\.resolve\(\s*2\s*,\s*\(\s*\)\s*=>\s*(\[.*?\])\s*\)\s*</script>",
    re.DOTALL,
)


def _normalize_cabin(s: str) -> str | None:
    s = (s or "").upper()
    if s in ("FIRST",):
        return "F"
    if s in ("BUSINESS",):
        return "J"
    if s in ("PREMIUM_CLASS", "PREMIUM", "PREMIUM_ECONOMY"):
        return "W"
    if s in ("COACH", "MAIN", "SAVER", "ECONOMY"):
        return "Y"
    return None


def _js_object_to_json(s: str) -> str | None:
    """Convert SvelteKit's JS-object literal (unquoted keys) to valid JSON.

    Heuristic: wrap any bareword keys followed by `:` in double quotes.
    Doesn't perfectly handle every edge case (numeric keys, escaped quotes
    inside strings) but works for Alaska's payload shape.
    """
    try:
        # 1. Quote bareword property names: `{key:` → `{"key":`
        out = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', s)
        # 2. Replace single-quoted strings with double-quoted (basic — fails on
        #    apostrophes inside, which Alaska's payload doesn't seem to use).
        out = re.sub(r"'([^'\\]*(?:\\.[^'\\]*)*)'", r'"\1"', out)
        # 3. Replace JS undefined / NaN with JSON nulls.
        out = re.sub(r"\b(undefined|NaN)\b", "null", out)
        return out
    except Exception as exc:  # noqa: BLE001
        log.debug("AS payload normalize failed: %s", exc)
        return None


def _parse(rows_payload: list[dict[str, Any]], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Extract NormalizedResult per row × cabin. Alaska's response is one
    top-level entry per departure-station pair (always 1 for our use case);
    inside, `rows[]` is the list of itineraries; each itinerary's
    `solutions{}` is keyed by FareType (REFUNDABLE_MAIN, REFUNDABLE_FIRST,
    NONREFUNDABLE_MAIN, …).
    """
    if not rows_payload:
        return []
    top = rows_payload[0]
    itineraries = top.get("rows") or []
    results: list[NormalizedResult] = []

    for row in itineraries[:5]:  # cap top 5
        try:
            segments_raw = row.get("segments") or []
            segments: list[ResultSegment] = []
            for i, seg in enumerate(segments_raw):
                pc = seg.get("publishingCarrier") or {}
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=pc.get("carrierCode") or "AS",
                        marketing_airline_iata=(
                            (seg.get("displayCarrier") or {}).get("carrierCode")
                            or pc.get("carrierCode")
                            or "AS"
                        ),
                        flight_number=str(pc.get("flightNumber") or ""),
                        origin_iata=seg.get("departureStation") or origin,
                        dest_iata=seg.get("arrivalStation") or dest,
                        depart_at=seg.get("departureTime") or f"{date}T00:00:00Z",
                        arrive_at=seg.get("arrivalTime") or f"{date}T00:00:00Z",
                        aircraft_icao=seg.get("aircraftCode"),
                        segment_cabin=_normalize_cabin(seg.get("cabin") or ""),
                        fare_class=seg.get("bookingCode"),
                    )
                )

            cabin_prices_by_code: dict[str, CabinPrice] = {}
            for _fare_type, sol in (row.get("solutions") or {}).items():
                if not isinstance(sol, dict):
                    continue
                cabins = sol.get("cabins") or []
                first_cabin = _normalize_cabin(cabins[0]) if cabins else None
                if not first_cabin:
                    continue
                miles = sol.get("atmosPoints") or sol.get("milesPoints") or 0
                taxes = sol.get("grandTotal") or 0
                if not miles:
                    continue
                seats = sol.get("seatsRemaining") or 0
                # Keep the lowest-miles solution per cabin (best price).
                existing = cabin_prices_by_code.get(first_cabin)
                if existing and existing.miles_per_pax <= int(miles):
                    continue
                cabin_prices_by_code[first_cabin] = CabinPrice(
                    cabin=first_cabin,  # type: ignore[arg-type]
                    seats_remaining=int(seats),
                    miles_per_pax=int(miles),
                    surcharge_usd_per_pax=0,  # AS partner awards: no YQ
                    taxes_usd_per_pax=int(round(float(taxes))),
                )

            if not cabin_prices_by_code:
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
                    total_duration_min=int(row.get("duration") or 0),
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=list(cabin_prices_by_code.values()),
                    confidence_score=88,  # AS scrapes are highly reliable
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("AS row parse error: %s", exc)
            continue
    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    params = {
        "O": origin,
        "D": dest,
        "OD": date,
        "A": "1",
        "C": "0",
        "L": "0",
        "RT": "false",
        "ShoppingMethod": "onlineaward",
        "awardType": "MilesOnly",
    }
    async with scrape_client(timeout_s=25.0) as client:
        try:
            r = await client.get(SEARCH_URL, params=params)
            if r.status_code != 200:
                log.warning("AS GET returned %s", r.status_code)
                return []
            html = r.text
            match = PAYLOAD_PATTERN.search(html)
            if not match:
                log.warning("AS hydration payload not found in HTML (%d chars)", len(html))
                return []
            raw = match.group(1)
            payload = None
            if _HAS_JSON5:
                try:
                    payload = json5.loads(raw)
                except Exception as exc:  # noqa: BLE001
                    log.debug("AS json5 parse failed: %s; trying regex fallback", exc)
            if payload is None:
                normalized = _js_object_to_json(raw)
                if not normalized:
                    return []
                try:
                    payload = json.loads(normalized)
                except json.JSONDecodeError as exc:
                    log.warning("AS regex-normalized parse failed: %s", exc)
                    return []
            return _parse(payload, origin, dest, date)
        except json.JSONDecodeError as exc:
            log.warning("AS JSON parse failed: %s", exc)
            return []
        except Exception as exc:  # noqa: BLE001
            log.warning("AS scrape failed: %s", exc)
            return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
