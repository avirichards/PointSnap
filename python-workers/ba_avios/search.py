"""British Airways Avios award search plugin.

REAL SCRAPE PENDING — requires HAR capture from a logged-in Executive
Club session (we have account) and Patchright-driven session bootstrap.

Research findings (Session 5 agent, May 2026):
  - The legacy "well-documented private API" cited in the architecture
    doc no longer exists. The Bitnami host
    (dev1-flightavail-avios.bitnamiapp.com) used by timrogers/ba_rewards
    (Ruby gem, 2014) is dead.
  - The public Reward Flight Finder (britishairways.com/travel/
    flightfinder/public) returns calendar PRESENCE only — no actual
    mile pricing or YQ breakdown — and has been buggy for most users
    since 2023 per Head for Points coverage.
  - Full pricing (Avios + YQ breakdown) requires Executive Club login.
    The mobile app embeds a per-session bearer minted from the login.
  - ba.com sits behind Akamai Bot Manager (`_abck`, `bm_sz`, `ak_bmsc`
    cookies). curl_cffi with chrome131 impersonation passes JA3/JA4
    but NOT the sensor_data validation Akamai requires for sustained
    calls. SeatSpy + RFF both moved to lower-frequency batch scraping
    after BA's 2021 third-party feed block.

To implement (next session with account creds):
  1. User shares Executive Club username + password via Fly secrets:
       fly secrets set BA_EXEC_CLUB_USER="..." BA_EXEC_CLUB_PASS="..."
  2. Patchright (undetected Playwright fork) via IPRoyal UK residential.
     Don't use datacenter IPs — Akamai geo-scores.
  3. Drive the ba.com UI directly: load the rewards search page, fill
     route/date, click search. Use `page.on("response")` to capture
     the actual XHR (BA renames internal endpoints every 12-18 months,
     so capturing live is the only reliable approach).
  4. Parse: cabins coded M/W/C/F → our Y/W/J/F enum; Avios in
     prices.prices.{A|cabin}; total cash in prices.rfs.tax (taxes +
     YQ consolidated — can't split without scraping the booking page).
  5. Throttle: one search per session, 10-30s human delays, rotate IP
     every session. Akamai escalates a residential IP fast on burst.

Difficulty: 4/5 in practice (architecture doc said 2/5 — outdated
since the 2021 BA block). First working scraper: ~1-2 weeks dedicated
work, not 1-3 days.

Until then, returns canonical seed data (BA JFK→NRT JL-coded partner
row from common/seed_data.py) via the canonical-fallback wrapper.
"""

from __future__ import annotations

import logging

from common.plugin_wrapper import with_canonical_fallback
from common.types import NormalizedResult

log = logging.getLogger(__name__)
PROGRAM_ID = "BA_AVIOS"


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """PENDING HAR capture + Patchright. See module docstring."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
