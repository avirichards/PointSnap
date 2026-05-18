"""Smoke tests for the Bright Data CDP path in browser_page().

The env-var-required test runs anywhere. The httpbin reachability test only
runs when BRIGHTDATA_WSS_URL is configured AND the host can reach
brd.superproxy.io:9222 (managed sandboxes often block non-standard ports;
run this locally or on Fly).
"""

from __future__ import annotations

import os

import pytest

from common.browser import browser_page


@pytest.mark.asyncio
async def test_brightdata_requires_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BRIGHTDATA_WSS_URL", raising=False)
    with pytest.raises(RuntimeError, match="BRIGHTDATA_WSS_URL"):
        async with browser_page(use_brightdata=True):
            pass


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.environ.get("BRIGHTDATA_WSS_URL"),
    reason="BRIGHTDATA_WSS_URL not configured",
)
async def test_brightdata_loads_httpbin() -> None:
    async with browser_page(use_brightdata=True, timeout_ms=30_000) as page:
        resp = await page.goto(
            "https://httpbin.org/headers", wait_until="domcontentloaded"
        )
        assert resp is not None
        assert resp.status == 200
        body = await page.content()
        assert '"User-Agent"' in body, "httpbin.org/headers should echo a UA"
