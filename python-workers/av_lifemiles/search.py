"""Avianca LifeMiles award search plugin.

REAL SCRAPE PENDING — requires HAR capture from a logged-in LifeMiles
session (we have account) + Patchright session bootstrap.

Research findings (Session 5 agent, May 2026):
  - Modern site (lifemiles.com/fly/find) is a SPA; underlying JSON XHR
    URL not publicly documented. Capture via DevTools after login.
  - Legacy ASPX flow (dynredcal.aspx → DYNREDCAL.ASPX → dynredflts.aspx)
    used by ak2912/Lifemiles on GitHub. Staleness risk: high — endpoints
    unconfirmed for 2026.
  - Logged-out browse NOT possible. Account + session cookie required.
  - LATAM IPs (CO/PE/SV) see better inventory parity. Avianca hubs are
    BOG/SAL/LIM; IPRoyal Colombia residential is right egress.
  - Seats.aero dropped + re-added LifeMiles at least once (system-change
    cited) — the surface is actively defended.

To implement (next session with account creds):
  1. User shares LifeMiles username + password via Fly secrets:
       fly secrets set LM_USER="..." LM_PASS="..."
  2. Capture the real /fly/find XHR endpoint via Patchright on a
     logged-in CO/PE residential session. Document URL + body shape.
  3. Patchright in headed-Xvfb mode through IPRoyal CO/PE residential.
     Two-step: Patchright login + cookie capture → curl_cffi replay
     for warm calls (don't run Patchright per request — too slow).
  4. Per-account rate limit: ak2912 notes results aren't returned
     immediately but stored server-side. ≥30s between searches per
     account. With a single account, throttle accordingly.
  5. Map to NormalizedResult: per-segment carrier+flight from the
     itinerary card; mile price per cabin from the "1 x N" pattern;
     taxes/fees from priced-itinerary USD totals.

Note: LifeMiles' "Smart Search" hides Star Alliance partners by default
(Frequent Miler + OMAAT both flag this). The scraper must force-select
specific carriers in the dropdown to surface partner inventory.

Difficulty: 3.5/5 in practice (architecture doc said 2/5).

Until then, returns canonical seed data (AV JFK→NRT NH-coded partner
row) via the canonical-fallback wrapper.
"""

from __future__ import annotations

import logging

from common.plugin_wrapper import with_canonical_fallback
from common.types import NormalizedResult

log = logging.getLogger(__name__)
PROGRAM_ID = "AV_LIFEMILES"


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """PENDING HAR capture + Patchright. See module docstring."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
