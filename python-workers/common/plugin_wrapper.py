"""Shared "try real, fall back to canonical" wrapper for scraper plugins.

Each program with a real scrape attempt imports `with_canonical_fallback` and
wraps its _scrape_real coroutine. Behavior:

  1. Call _scrape_real(origin, dest, date, cabin_filter).
  2. If it returns a non-empty list → return that (real data).
  3. If it returns [] or raises → log + fall back to canonical seed data
     from common/seed_data.py (the same canonical row served by
     make_mock_plugin for programs without a real scrape attempt).
  4. Off-route queries (e.g. asking BA for HKG→LHR when the canonical
     seed is JFK→NRT) return [] — cockpit's chart fallback then takes
     over.

This way every plugin always returns SOMETHING when on-route, and the
cockpit never goes blank during the slow transition from canonical →
real over Sessions 5-10.
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable

from common.mock_plugin import make_mock_plugin
from common.types import NormalizedResult

log = logging.getLogger(__name__)

ScrapeFn = Callable[[str, str, str, str], Awaitable[list[NormalizedResult]]]


def with_canonical_fallback(program_id: str, real_scrape: ScrapeFn) -> ScrapeFn:
    """Wrap a real-scrape coroutine with canonical-data fallback."""
    canonical = make_mock_plugin(program_id)

    async def search(
        origin: str,
        dest: str,
        date: str,
        cabin_filter: str = "Y",
    ) -> list[NormalizedResult]:
        try:
            results = await real_scrape(origin, dest, date, cabin_filter)
            if results:
                log.info(
                    "%s real scrape OK: %d row(s) for %s→%s on %s",
                    program_id, len(results), origin, dest, date,
                )
                return results
            log.info(
                "%s real scrape returned empty for %s→%s; trying canonical",
                program_id, origin, dest,
            )
        except Exception as exc:  # noqa: BLE001 — scraper errors are routine
            log.warning(
                "%s real scrape failed: %s; falling back to canonical",
                program_id, exc,
            )
        return await canonical(origin, dest, date, cabin_filter)

    return search
