"""Shared HTTP client for real scraper plugins.

Builds an httpx.AsyncClient configured with the IPRoyal residential proxy
when IPROYAL_PROXY_HOST/USER/PASS are present in the Fly app env. Falls
back to direct connection (no proxy) when unset — useful for local dev
and for endpoints that don't need geo-targeted egress.

curl_cffi could be substituted here later for TLS-fingerprint impersonation
on endpoints that 403 plain httpx; we start with vanilla httpx + a realistic
Chrome User-Agent to see how far it gets.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx


CHROME_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

DEFAULT_HEADERS = {
    "User-Agent": CHROME_UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    # br (brotli) deliberately omitted — httpx doesn't decompress brotli
    # without the `brotli` package, and Virgin Atlantic / United / others
    # readily return br when offered, then we 500 on decode. gzip/deflate
    # are universally safe.
    "Accept-Encoding": "gzip, deflate",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}


def proxy_url(country: str | None = None, session: str | None = None) -> str | None:
    """Construct an http://user:pass_country-cc@host:port URL from env, or None.

    IPRoyal targeting goes on the PASSWORD field — `password_country-us`
    forces US exits, `_session-xxx_lifetime-10m` makes the exit sticky."""
    host = os.environ.get("IPROYAL_PROXY_HOST")
    port = os.environ.get("IPROYAL_PROXY_PORT")
    user = os.environ.get("IPROYAL_PROXY_USER")
    password = os.environ.get("IPROYAL_PROXY_PASS")
    if not all([host, port, user, password]):
        return None
    country = (country or os.environ.get("IPROYAL_COUNTRY") or "us").lower()
    pwd_suffixed = f"{password}_country-{country}"
    if session:
        pwd_suffixed = f"{pwd_suffixed}_session-{session}_lifetime-10m"
    return f"http://{user}:{pwd_suffixed}@{host}:{port}"


@asynccontextmanager
async def scrape_client(
    timeout_s: float = 30.0,
    extra_headers: dict[str, str] | None = None,
    use_proxy: bool = True,
) -> AsyncIterator[httpx.AsyncClient]:
    """Yield an httpx.AsyncClient pre-configured for airline scraping.

    Uses the IPRoyal proxy when configured; falls back to direct connection
    otherwise. Always sends Chrome-like headers + cookies preserved across
    requests in the same `with` block.
    """
    headers = {**DEFAULT_HEADERS}
    if extra_headers:
        headers.update(extra_headers)

    proxy = proxy_url() if use_proxy else None
    kwargs: dict = {
        "timeout": httpx.Timeout(timeout_s, connect=10.0),
        "headers": headers,
        "follow_redirects": True,
        "http2": False,  # disabled to keep IPRoyal HTTP CONNECT path simple
    }
    if proxy:
        kwargs["proxy"] = proxy

    async with httpx.AsyncClient(**kwargs) as client:
        yield client
