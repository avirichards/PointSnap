"""ANA Mileage Club partner-award search plugin.

REAL SCRAPE PENDING — needs Patchright + ANA AMC account creds.

Research findings (Session 5 agent):
  Endpoints (verified from flightplan-tool nh/searcher.js):

  - Login page: https://www.ana.co.jp/en/us/amc/ → fill #accountNumber +
    #password → submit #amcMemberLogin
  - Award search host (separate from www.ana.co.jp):
    https://aswbe-i.ana.co.jp/international_asw/pages/award/search/
    roundtrip/award_search_roundtrip_input.xhtml?CONNECTION_KIND=JPN&
    LANG=en
  - Form submission: standard JSF POST to same XHTML with
    javax.faces.ViewState + requestedSegment:N:* field bag (origin,
    destination, YYYYMMDD date, pax). Round-trip = two segments in same
    POST (requestedSegment:0 outbound, requestedSegment:1 inbound).
  - Response: server-rendered HTML (no clean JSON XHR). Parser lifts
    segment cells (carrier + flight #), times, cabin availability per
    FS/CS/WS/YS (First/Business/Premium/Economy Standard = Saver).

  Session bridge: login on www.ana.co.jp does NOT auto-extend to
  aswbe-i.ana.co.jp. Navigate through "Use Miles → Partner Award" UI
  path so the session bridges.

  Anti-bot: LIGHTER than the others (no Akamai BMP on aswbe-i). Rate-
  limiting + session-age signals. Japan IPs NOT required; flightplan
  works globally. Use IPRoyal US residential matching account's country
  of record.

To implement (next session with account creds):
  fly secrets set ANA_AMC_USER="..." ANA_AMC_PASS="..."

  1. Patchright sufficient (curl_cffi works for JSF POST once you have
     the ViewState, but lifecycle is annoying — use browser).
  2. Login on www.ana.co.jp → click through Use Miles → International
     Award → Partner so aswbe-i JSESSIONID gets established before form
     POST.
  3. Cap to ~30s between searches per account (ANA throttles by
     per-session search count, not IP).
  4. RT-only on most partner pairs is a chart constraint, not scraper.
     Model NormalizedResult as RT with outbound_segments[] +
     inbound_segments[].
  5. Parse via lxml / selectolax; cache the airport dictionary from
     Asw.AirportList JS global.

Until then, returns canonical seed (NH9 JFK→NRT) via canonical-fallback
wrapper.
"""

from __future__ import annotations

import logging

from common.plugin_wrapper import with_canonical_fallback
from common.types import NormalizedResult

log = logging.getLogger(__name__)
PROGRAM_ID = "NH_ANA"


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """PENDING Patchright + AMC auth. See module docstring."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
