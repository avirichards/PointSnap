"""Air Canada Aeroplan award search plugin.

REAL SCRAPE PENDING — Patchright + Aeroplan account creds required.
User has authorized scraping for personal use (May 2026).

Research findings (Session 5 agent):
  Endpoints (verified from AwardWiz aeroplan.ts, archived Sept 2024
  but structure still current):

  - Search page (drives the XHRs): GET https://www.aircanada.com/aeroplan/
    redeem/availability/outbound?org0={ORG}&dest0={DEST}&departureDate0=
    {YYYY-MM-DD}&lang=en-CA&tripType=O&ADT=1&YTH=0&CHD=0&INF=0&INS=0&
    marketCode=TNB
  - Token bootstrap (XHR): POST .../loyalty/dapidynamic/{path}/v2/reward/
    market-token  (403 here = Akamai block)
  - AWARD AVAILABILITY (XHR JSON — the target): GET .../loyalty/
    dapidynamic/{path}/v2/search/air-bounds
  - Login: rendered HTML form at https://www.aircanada.com/aeroplan/login

  Response shape: data.airBoundGroups[] → boundDetails.segments[] →
  prices.milesConversion.convertedMiles.base + .totalTaxes (cents).
  Cabins: eco | ecoPremium | business | first. Partner segments (UA,
  LH, NH, etc.) inline with same shape. Distance-based per Aeroplan's
  2020 chart.

  Anti-bot: Akamai Bot Manager v3 (sensor.js, sensor_data POST, _abck/
  bm_sz/ak_bmsc cookies). curl_cffi alone can't mint valid sensor_data
  — Patchright required.

To implement (next session with account creds):
  fly secrets set AEROPLAN_USER="..." AEROPLAN_PASS="..."

  1. Patchright (Chromium with CDP leaks patched) via IPRoyal US
     residential. NO datacenter IPs.
  2. Warm session: home page → login → wait for _abck to flip to ~0~
     state before navigating to the search URL.
  3. Block go-mpulse.net + adobedtm.com (telemetry only — doesn't
     affect search).
  4. CDP response listener filtered on
     */loyalty/dapidynamic/*/v2/search/air-bounds; resolve when fired.
  5. On market-token 403 (3 consecutive) → rotate proxy + warmed
     account. Aeroplan's per-IP scoring is tight.

Until then, returns canonical seed data (AC JFK→NRT NH5961 codeshare
row) via canonical-fallback wrapper.
"""

from __future__ import annotations

import logging

from common.plugin_wrapper import with_canonical_fallback
from common.types import NormalizedResult

log = logging.getLogger(__name__)
PROGRAM_ID = "AC_AEROPLAN"


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """PENDING Patchright + Aeroplan auth. See module docstring."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
