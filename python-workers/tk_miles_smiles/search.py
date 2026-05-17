"""Turkish Miles&Smiles award search plugin.

REAL SCRAPE PENDING — requires Miles&Smiles login (we have account) +
phantom-availability two-step verification.

Research findings (Session 5 agent, May 2026):
  - Endpoint NOT publicly documented. No OSS scraper (AwardWiz et al.)
    targets tkmiles directly. Apify's igolaizola/flight-award-scraper
    claims Turkish support but path is closed-source.
  - Award booking at turkishairlines.com/en-int/miles-and-smiles/
    book-award-tickets/availability. Internal AJAX likely posts to
    /availability or /v1/booking/availability on the same host.
  - Turkish has an official developer portal
    (developer.apim.turkishairlines.com) with a "Get Availability" API
    gated for B2B partners — not the consumer surface.
  - Consumer award flow REQUIRES a logged-in M&S account. Session-
    cookie based (JSESSIONID-style + CSRF). Logged-out users only see
    the search form, not results.
  - Anti-bot: Akamai-flavored, lighter than United but real. `_abck`/
    `bm_sz` cookies + session-level rate caps. Per-account behavior
    tracking means burning a real M&S account is real cost.
  - PHANTOM AVAILABILITY (per FlyerTalk thread): search results show
    fare classes (esp. Business Saver) that error at the next step
    with "All our seats in the fare class you have selected are full."
    Call center sometimes books what the website rejects. Scraper MUST
    advance past seat-select / price-confirm to mark a result truly
    bookable. Surface a `bookable_confidence` flag rather than binary.
  - PER-SEGMENT DYNAMIC PRICING (post-2024 reprice): multi-segment
    itineraries sum per-segment award prices rather than charging a
    single zone-based amount. Response carries mile cost per segment.

To implement (next session with account creds):
  1. User shares M&S username + password via Fly secrets:
       fly secrets set TK_MS_USER="..." TK_MS_PASS="..."
  2. Patchright + IPRoyal residential, sticky-session per account
     (don't cross IPs within one login).
  3. Two-step verification per result: (a) record /availability JSON;
     (b) advance one screen to price/seat step and record whether the
     carrier rejects. Persist both — that's the phantom signal.
  4. Once XHR captured, try curl_cffi chrome131 replay with M&S session
     cookies — could be 50-100× faster but the JS-anti-replay layer
     breaks it within days.
  5. Rate-limit hard per account (≤1 search / 10s). Banning a real
     M&S account is permanent revenue loss.

Difficulty: 3.5/5 in practice.

Until then, returns canonical seed data (TK JFK→IST→NRT row) via the
canonical-fallback wrapper.
"""

from __future__ import annotations

import logging

from common.plugin_wrapper import with_canonical_fallback
from common.types import NormalizedResult

log = logging.getLogger(__name__)
PROGRAM_ID = "TK_MILES_SMILES"


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """PENDING HAR capture + Patchright + phantom-availability check. See module docstring."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
