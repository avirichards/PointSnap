"""LH_MILES_MORE plugin.

Real scrape BLOCKED: Lufthansa M&M enforces 7,000 mile minimum balance per account before returning award data. Returns canonical until warmed accounts (Session 6+); v1.1 per architecture doc.
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
    """Real-scrape attempt. Returns [] today so the wrapper falls back to
    canonical seed data. Implementation lands as scrapers come online."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
