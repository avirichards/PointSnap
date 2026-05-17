"""Cathay Asia Miles award search plugin.

REAL SCRAPE PENDING — needs Patchright + Cathay account creds.

Research findings (Session 5 agent, verified via Greasyfork "Unelevated"
v4.0.3 source):

  Endpoints:
  - Login URL: https://www.cathaypacific.com/content/cx/{lang}_{country}/
    sign-in.html?loginreferrer=...redeem-flight-awards.html
  - Session probe: GET https://api.cathaypacific.com/redibe/login/
    getProfile (non-200 = not logged in)
  - Static asset path discovery: rendered redeem facade page exposes
    staticFilesPath, e.g. /CathayPacificAwardV3/AML_IT3.1.14/ (version
    bumps periodically — must scrape from page, not hardcode)
  - TAB_ID + requestParams: facade page exposes these JS globals
  - AWARD AVAILABILITY (the real one):
    POST https://book.cathaypacific.com/CathayPacificAwardV3/dyn/air/
    booking/availability?TAB_ID={TAB_ID}
    Content-Type: application/x-www-form-urlencoded
    Body: requests[*] keys for origin/destination/date/pax
  - Airport dictionary: GET https://api.cathaypacific.com/redibe/airport/
    origin/{lang}/ and .../destination/{from}/{lang}/

  20-CALL CHECKSUM WINDOW: after ~20 sequential availability POSTs the
  backend stamps a session-level signature that throttles or invalidates
  TAB_ID. Re-load facade.html every 15-18 queries for a fresh
  staticFilesPath + TAB_ID.

  Response: zone × cabin pricing per segment as JSON; fuel surcharge
  broken out separately (doubled March 2026 per Verylvke). Cabins use
  F1/F2/C1/C2/W1/W2/Y1/Y2 variants for Standard/Choice/Tailored — only
  *S (Standard) is the saver row PointSnap cares about.

  Anti-bot: Akamai BMP + JA4 fingerprinting heavily monitored on
  book.cathaypacific.com. Full sensor_data round-trip on facade load.

To implement (next session with account creds):
  fly secrets set CX_USER="..." CX_PASS="..."

  1. Patchright mandatory (curl_cffi insufficient — sensor_data needed).
     HK/SG residential IP best; US residential works for Asia Miles US-
     member accounts.
  2. Load redeem-flight-awards.html → wait for staticFilesPath / tabId
     JS globals → scrape them.
  3. POST to availability?TAB_ID=... with form-encoded segment requests;
     parse JSON response.
  4. Counter every successful search; at ≥18, re-load facade for fresh
     TAB_ID.
  5. On 'Login' error string in response → cookies expired; re-login via
     getProfile probe + login URL.

Until then, returns canonical seed (CX841/CX548 JFK→HKG→NRT) via
canonical-fallback wrapper.
"""

from __future__ import annotations

import logging

from common.plugin_wrapper import with_canonical_fallback
from common.types import NormalizedResult

log = logging.getLogger(__name__)
PROGRAM_ID = "CX_CATHAY"


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """PENDING Patchright + CX auth + TAB_ID rotation. See module docstring."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
