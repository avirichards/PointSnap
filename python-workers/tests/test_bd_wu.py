"""Smoke tests for the BD Web Unlocker helper + AA WU variant.

These tests only exercise import + env-var handling. Live WU calls against
BD's API cost money and depend on AA's app-layer behavior, so they're
deliberately out of scope — exercise via the `/diag/aa_wu_last` endpoint
on a deployed Fly worker instead.
"""

from __future__ import annotations

import pytest


def test_bd_wu_module_imports_cleanly() -> None:
    """If this fails, common/bd_wu.py has a syntax / import error."""
    from common import bd_wu

    assert hasattr(bd_wu, "wu_post")
    assert hasattr(bd_wu, "wu_get")
    assert bd_wu.WU_ENDPOINT == "https://api.brightdata.com/request"


def test_search_wu_module_imports_cleanly() -> None:
    """If this fails, aa_aadvantage/search_wu.py has a syntax / import error."""
    from aa_aadvantage import search_wu

    assert hasattr(search_wu, "search_via_wu")
    assert hasattr(search_wu, "search")
    assert search_wu.search is search_wu.search_via_wu
    assert search_wu.AA_API_ENDPOINT == (
        "https://www.aa.com/booking/api/search/itinerary"
    )


@pytest.mark.asyncio
async def test_wu_post_requires_token(monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing BRIGHTDATA_WU_TOKEN should raise loudly, not silently no-op."""
    monkeypatch.delenv("BRIGHTDATA_WU_TOKEN", raising=False)
    monkeypatch.setenv("BRIGHTDATA_WU_ZONE", "pointsnap_webunlock")
    from common.bd_wu import wu_post

    with pytest.raises(RuntimeError, match="BRIGHTDATA_WU_TOKEN"):
        await wu_post("https://example.com/", body={"x": 1})


@pytest.mark.asyncio
async def test_wu_post_requires_zone(monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing BRIGHTDATA_WU_ZONE should raise loudly."""
    monkeypatch.setenv("BRIGHTDATA_WU_TOKEN", "fake-token")
    monkeypatch.delenv("BRIGHTDATA_WU_ZONE", raising=False)
    from common.bd_wu import wu_post

    with pytest.raises(RuntimeError, match="BRIGHTDATA_WU_ZONE"):
        await wu_post("https://example.com/", body={"x": 1})


@pytest.mark.asyncio
async def test_wu_get_requires_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BRIGHTDATA_WU_TOKEN", raising=False)
    monkeypatch.delenv("BRIGHTDATA_WU_ZONE", raising=False)
    from common.bd_wu import wu_get

    with pytest.raises(RuntimeError):
        await wu_get("https://example.com/")


def test_build_aa_payload_shape() -> None:
    """Payload must keep the AA-expected shape — drift here regresses to 309."""
    from aa_aadvantage.search_wu import _build_aa_payload

    body = _build_aa_payload("JFK", "LAX", "2026-08-15")
    assert body["requestHeader"]["clientId"] == "AAcom"
    assert body["tripOptions"]["searchType"] == "Award"
    assert body["tripOptions"]["fareType"] == "Lowest"
    assert body["passengers"] == [{"type": "adult", "count": 1}]
    assert len(body["slices"]) == 1
    sl = body["slices"][0]
    assert sl["origin"] == "JFK"
    assert sl["destination"] == "LAX"
    assert sl["departureDate"] == "2026-08-15"
    assert sl["allCarriers"] is True
