"""Lufthansa Miles & More award search plugin.

REAL SCRAPE PENDING — hardest of all 13. Most aggressive Akamai posture.

Research findings (Session 5 agent):
  Endpoints: NO public scraper has cleanly reverse-engineered the M&M
  XHR paths. All public references (FlyerTalk, Verylvke, seats.aero,
  OMAAT) confirm the search is browser-rendered behind Akamai BMP.

  - Public consumer search: https://www.miles-and-more.com/{region}/
    {lang}/spend/award-overview.html → award-flight booking widget that
    posts to a Lufthansa NDC-style booking backend (lufthansa.com/api/
    ... under the hood)
  - Login: Miles & More service card # + PIN at
    https://www.miles-and-more.com/{region}/{lang}/account/login.html
    (sets cross-domain cookies that the booking widget reads)
  - Official Open API (developer.lufthansa.com): OAuth2, /v1/operations
    endpoints for fares/availability — does NOT include award inventory
    or M&M mile pricing. Not viable for PointSnap.

  REQUIRED: ≥7,000 mile balance per account (Verylvke + FlyerTalk
  confirmed). User has warmed accounts meeting this.

  Anti-bot: MOST aggressive of the four account-required programs.
  FlyerTalk reports three Akamai "I'm not a robot" interstitials per
  single search on Senator accounts, often per date change. Stacked
  challenges = BMP scoring set to high sensitivity (sensor_data +
  behavioral + per-XHR re-validation).

  Response shape (inferred from screenshots/FlyerTalk): partner-chart
  prices for non-LH/LX/OS metal (e.g. NA↔Europe J = 125k/RT one Star
  partner). Dynamic pricing for LH/LX/OS own-metal post-June 2025 —
  mile + cash co-pay tied to cash fare bucket.

To implement (next session with account creds):
  fly secrets set MM_CARD_NUM="..." MM_PIN="..."

  1. Patchright is the ONLY path — no clean JSON endpoint reverse-
     engineered + Akamai sensitivity precludes curl_cffi.
  2. CAPTURE STEP (you, user, with DevTools): load search → inspect
     XHRs → record actual POST URL + body shape from a logged-in M&M
     session. PointSnap bakes URL/shape into the scraper.
  3. EU residential IPs (German preferred) to match LH's expected
     traffic profile. US residential triggers more challenges.
  4. Throttle: ≤1 search per 30s per account, full page reload between
     searches to let _abck re-validate. Rotate across multiple warmed
     accounts (7k mile floor is per account).
  5. Expect ~10-15% manual-review failure rate even with Patchright +
     realistic mouse-jitter scripts. Budget for it.

Per the architecture doc: defer to v1.1 was the original
recommendation. With warmed accounts, in-scope but easily a 5-week
build.

Until then, returns canonical seed (LH401/LH716 JFK→FRA→NRT F-only)
via canonical-fallback wrapper.
"""

from __future__ import annotations

import logging

from common.plugin_wrapper import with_canonical_fallback
from common.types import NormalizedResult

log = logging.getLogger(__name__)
PROGRAM_ID = "LH_MILES_MORE"


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """PENDING Patchright + M&M auth + HAR capture. See module docstring."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
