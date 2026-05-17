"""Air France/KLM Flying Blue award search plugin.

REAL SCRAPE PENDING — login-walled since August 2024 + Imperva. Needs
HAR capture from a logged-in FB session (we have account) + Patchright.

Research findings (Session 5 agent, May 2026):
  - August 2024: Flying Blue moved award search behind login wall. This
    broke seats.aero and PointsYeah. Point.me kept Flying Blue coverage
    only by maintaining pre-logged-in account sessions; their searches
    are noticeably slower as a result.
  - Public surface (flyingblue.com → wwws.airfrance.com / klm.com
    /spend/flights/rewards) is form-driven; the underlying award JSON
    XHR URL is NOT publicly documented. Capture via DevTools on a
    logged-in session.
  - Promo Rewards (monthly 25%-off rewards) served separately from the
    same edge — likely a static JSON file keyed by route.
  - AF-KLM Developer Portal (developer.airfranceklm.com) Offers/NDC are
    CASH-fare APIs. Reward inventory not publicly exposed. Not viable.
  - Imperva (Incapsula) confirmed: `incap_ses_*`, `visid_incap_*`,
    `_Incapsula_Resource` cookies + JS challenges. curl_cffi alone is
    insufficient — the JS challenge sets the bypass cookie and a pure
    HTTP client can't execute it cold.
  - France/Netherlands residential egress blends best (Imperva geo-
    scores against AF/KLM's customer base).

To implement (next session with account creds):
  1. User shares Flying Blue username + password via Fly secrets:
       fly secrets set FB_USER="..." FB_PASS="..."
  2. Patchright via IPRoyal FR/NL residential. Login + solve Imperva,
     capture the real XHR endpoint via `page.on("response")`.
  3. Two-stage architecture: Patchright handles Imperva + login; export
     cookies to curl_cffi for actual search XHRs (this is what Point.me
     appears to do).
  4. Throttle <60 searches/hour per account to avoid the "search greyed
     out" account-level shutoff FlyerTalk users report.
  5. Map to NormalizedResult: Flying Blue is fully dynamic pricing
     (no chart bands). Each cabin × date returns a `miles` int + `taxes`
     object with EUR cash component. AF/KLM-marketed-and-operated
     usually low YQ; partner metal (DL/KE/KQ) variable.

Difficulty: 3/5 in practice (architecture doc said 2/5 — outdated
since the Aug 2024 login wall).

Until then, returns canonical seed data (AF JFK→CDG→NRT mixed-cabin
row) via the canonical-fallback wrapper.
"""

from __future__ import annotations

import logging

from common.plugin_wrapper import with_canonical_fallback
from common.types import NormalizedResult

log = logging.getLogger(__name__)
PROGRAM_ID = "AF_FLYINGBLUE"


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """PENDING HAR capture + Patchright + Imperva bypass. See module docstring."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
