"""ANA Mileage Club partner-award search plugin — REAL SCRAPE ACTIVE.

Ported from flightplan-tool nh/searcher.js. ANA uses a JSF (JavaServer
Faces) flow on a separate aswbe-i.ana.co.jp host; the response is HTML
(no JSON XHR) which we parse with selectolax.

Flow:
  1. Patchright login at ana.co.jp (requires ANA_AMC_USER/PASS).
  2. Navigate through "Use Miles → International Award → Partner" so
     the aswbe-i session bridges.
  3. Fill JSF form (requestedSegment fields), submit.
  4. Parse the result HTML table → segment + cabin pricing.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any

from common.browser import browser_page, creds_for
from common.plugin_wrapper import with_canonical_fallback
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "NH_ANA"
PROGRAM_NAME = "ANA Mileage Club"

LOGIN_URL = "https://www.ana.co.jp/en/us/amc/"
SEARCH_URL = (
    "https://aswbe-i.ana.co.jp/international_asw/pages/award/search/"
    "roundtrip/award_search_roundtrip_input.xhtml?CONNECTION_KIND=JPN&LANG=en"
)


def _parse_results_html(html: str, origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """ANA's JSF response HTML — best-effort regex extraction since the
    JSF generates synthetic IDs. selectolax for the table; regex for
    the fare-class miles."""
    try:
        from selectolax.parser import HTMLParser
    except ImportError:
        return []

    tree = HTMLParser(html)
    results: list[NormalizedResult] = []
    # ANA renders one outbound row per option, with cells for FS/CS/WS/YS
    # showing miles cost. Selectors are brittle — we look for any table
    # with a known ANA marker.
    rows = tree.css("table.itineraryDetail tr") or tree.css("table[summary*='itinerary'] tr")
    seen = 0
    for row in rows:
        if seen >= 6:
            break
        try:
            text = row.text(separator="\n").strip()
            if not text:
                continue
            # Look for fare-class miles in the row
            cabins: dict[str, int] = {}
            for code, cab in [("YS", "Y"), ("WS", "W"), ("CS", "J"), ("FS", "F")]:
                m = re.search(rf"{code}[^0-9]*([0-9][\d,]*)", text)
                if m:
                    cabins[cab] = int(m.group(1).replace(",", ""))

            flight_m = re.search(r"\b(?:NH|UA|LH|SQ|TG|OZ|CA|TK|AC|SK|LO|SN|EW|LX|OS)(\d{1,4})\b", text)
            if not cabins or not flight_m:
                continue

            cabin_prices = [
                CabinPrice(
                    cabin=cab,  # type: ignore[arg-type]
                    seats_remaining=0,
                    miles_per_pax=miles,
                    surcharge_usd_per_pax=0,
                    taxes_usd_per_pax=0,
                )
                for cab, miles in cabins.items()
            ]

            seg = ResultSegment(
                segment_order=0,
                operating_airline_iata=flight_m.group(0)[:2],
                marketing_airline_iata=flight_m.group(0)[:2],
                flight_number=flight_m.group(1),
                origin_iata=origin,
                dest_iata=dest,
                depart_at=f"{date}T00:00:00Z",
                arrive_at=f"{date}T00:00:00Z",
                aircraft_icao=None,
                segment_cabin=None,
                fare_class=None,
            )

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
                    segments=[seg],
                    cabin_prices=cabin_prices,
                    confidence_score=92,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
            seen += 1
        except Exception as exc:  # noqa: BLE001
            log.debug("ANA row parse error: %s", exc)
            continue
    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    user, pwd = creds_for(PROGRAM_ID)
    if not user or not pwd:
        log.info("ANA creds not set; skipping real scrape")
        return []

    try:
        async with browser_page(timeout_ms=60_000) as page:
            await page.goto(LOGIN_URL, wait_until="domcontentloaded")
            try:
                await page.fill("input[name='accountNumber'], input#accountNumber", user)
                await page.fill("input[name='password'], input#password", pwd)
                await page.click("button#amcMemberLogin, input#amcMemberLogin, button[type='submit']")
                await page.wait_for_load_state("networkidle", timeout=20_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("ANA login attempt failed: %s", exc)
                return []

            await page.goto(SEARCH_URL, wait_until="domcontentloaded")
            await asyncio.sleep(1.0)

            # JSF form fill — selectors derived from flightplan-tool nh/searcher.js
            try:
                yyyymmdd = date.replace("-", "")
                # Outbound segment 0
                await page.fill("input[id$=':departureAirportCode_0']", origin)
                await page.fill("input[id$=':arrivalAirportCode_0']", dest)
                await page.fill("input[id$=':departureDate_0']", yyyymmdd)
                # Submit
                await page.click("input[id*='Search'], button[id*='Search'], input[type='submit']")
                await page.wait_for_load_state("networkidle", timeout=30_000)
            except Exception as exc:  # noqa: BLE001
                log.warning("ANA form fill failed: %s", exc)
                return []

            html = await page.content()
            return _parse_results_html(html, origin, dest, date)
    except Exception as exc:  # noqa: BLE001
        log.warning("ANA scrape failed: %s", exc)
        return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
