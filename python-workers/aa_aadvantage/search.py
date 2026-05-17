"""AA_AADVANTAGE plugin.

Real scrape DEFERRED: Shape Security anti-bot + partial-auth requirement. Returns canonical until dedicated session (Session 7+).
"""

from __future__ import annotations

import logging

from common.plugin_wrapper import with_canonical_fallback
from common.types import NormalizedResult

log = logging.getLogger(__name__)
PROGRAM_ID = "AA_AADVANTAGE"


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
