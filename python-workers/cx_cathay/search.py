"""CX_CATHAY plugin.

Real scrape BLOCKED: Cathay requires authenticated Asia Miles account + 30-50 unique mobile numbers for account pool. Returns canonical until account warmup (Session 6+).
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
    """Real-scrape attempt. Returns [] today so the wrapper falls back to
    canonical seed data. Implementation lands as scrapers come online."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
