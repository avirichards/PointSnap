"""Bright Data Web Unlocker (WU) HTTP-API helper.

WU is a different BD product from Browser API + Residential Proxy: it's a
single-shot HTTPS API that handles bot defense on BD's side and returns
the target site's response (HTML or JSON) verbatim. We POST our target
URL + payload to BD; BD does whatever it needs (proxy rotation, captcha
solving, sensor.js bypass), then returns the response.

API contract:

    POST https://api.brightdata.com/request
    Authorization: Bearer <BRIGHTDATA_WU_TOKEN>
    Content-Type: application/json

    {
      "zone":   "<BRIGHTDATA_WU_ZONE>",     # e.g. "pointsnap_webunlock"
      "url":    "https://www.aa.com/booking/api/search/itinerary",
      "method": "POST",                      # or "GET"
      "body":   "<stringified request body>",# WU uses `body`, NOT `data`
      "format": "raw",                       # raw passes target response through
      "headers": {"Content-Type": "application/json", ...}  # optional
    }

Field-name gotchas (Session 5 phase C log entry, scraper-log.md L292-305):
  * The POST body field is `body` (NOT `data`). `data` is rejected with
    `"data" is not allowed`.
  * `format: "raw"` gives the target's raw response. `format: "json"`
    asks BD to wrap the response in a JSON envelope (status, body, headers
    on `x-brd-*` keys) — useful for HTML fetches where we want metadata,
    but raw is the right default for an API-shape target like AA's.

Status semantics:
  * HTTP 200 from WU means "BD successfully made the request" — the
    target's status is encoded in WU response headers (`x-brd-status`)
    when format=json, or it's just the target's body verbatim when
    format=raw. With raw, `httpx.Response.status_code` is the target's
    actual status.
  * HTTP 4xx/5xx from WU means BD itself rejected (validation error,
    no credit, zone disabled, captcha-not-solvable, …). The body is a
    BD JSON error doc, not the target's response.

Env vars:
  * `BRIGHTDATA_WU_TOKEN` — account-level Bearer token (BD account API key)
  * `BRIGHTDATA_WU_ZONE`  — zone slug (e.g. "pointsnap_webunlock")

Both are required; the helper raises RuntimeError if either is missing.
The user sets these as Fly secrets — never commit a value.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

WU_ENDPOINT = "https://api.brightdata.com/request"


def _read_wu_env() -> tuple[str, str]:
    """Return `(token, zone)` from env, raising if either is unset.

    Kept private so callers don't accidentally log the token. Both vars
    are mandatory: WU is a paid product, calling it without credentials
    is always a misconfiguration we want to surface loudly.
    """
    token = os.environ.get("BRIGHTDATA_WU_TOKEN")
    zone = os.environ.get("BRIGHTDATA_WU_ZONE")
    if not token:
        raise RuntimeError(
            "BRIGHTDATA_WU_TOKEN env var is required for bd_wu.* helpers. "
            "Set it as a Fly secret (account-level BD API key). "
            "See tasks/scraper-log.md 'Web Unlocker zone' section."
        )
    if not zone:
        raise RuntimeError(
            "BRIGHTDATA_WU_ZONE env var is required for bd_wu.* helpers. "
            "Set it to your BD WU zone slug (e.g. 'pointsnap_webunlock')."
        )
    return token, zone


async def wu_post(
    url: str,
    body: dict[str, Any] | str,
    headers: dict[str, str] | None = None,
    timeout_s: float = 60.0,
) -> tuple[int, dict[str, Any] | None, str]:
    """POST `body` to `url` via Bright Data Web Unlocker.

    Args:
      url: Target URL (e.g. AA's award-search API endpoint).
      body: Request body to forward to the target. `dict` is JSON-encoded;
        `str` is forwarded verbatim. Note WU's API field is `body`, not
        `data` — passing a dict here is fine, we stringify it before
        wrapping in the WU envelope.
      headers: Optional headers WU should forward to the target. Defaults
        to `{"Content-Type": "application/json", "Accept": "application/json"}`
        when `body` is a dict.
      timeout_s: Httpx total-deadline timeout. WU itself can take 30-60s
        on first hit for cold zones (BD spins up a session, solves the
        challenge, then fetches).

    Returns:
      `(status_code, parsed_json_or_None, raw_text)` — full visibility so
      callers can distinguish "target returned JSON we parsed" from "target
      returned HTML / error body" from "WU itself errored." Specifically:

      * `status_code` is the HTTP status from BD's WU endpoint. Note that
        with `format: "raw"`, BD passes the *target*'s status straight
        through, so `200` here means AA's API returned 200. A `4xx` here
        could be either AA rejecting or WU rejecting — inspect `raw_text`.
      * `parsed_json_or_None` is the body parsed as JSON if Content-Type
        is JSON-y *and* parsing succeeds. Otherwise None.
      * `raw_text` is the verbatim response body (capped to httpx defaults).
        Always populated, useful for diagnostics when JSON parse fails.

    Raises:
      RuntimeError: env vars missing.
      httpx.HTTPError: network / timeout failure reaching `api.brightdata.com`.
    """
    token, zone = _read_wu_env()

    # WU expects `body` as a string when forwarding to the target. JSON-encode
    # dicts; pass strings through. Strip the Content-Length / Host headers
    # if a caller accidentally forwards them — BD computes those itself.
    body_str = json.dumps(body) if isinstance(body, dict) else body
    forwarded_headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if headers:
        forwarded_headers.update(headers)
    for hop_header in ("Host", "Content-Length", "host", "content-length"):
        forwarded_headers.pop(hop_header, None)

    wu_envelope: dict[str, Any] = {
        "zone": zone,
        "url": url,
        "method": "POST",
        "body": body_str,
        "format": "raw",
        "headers": forwarded_headers,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
        resp = await client.post(
            WU_ENDPOINT,
            json=wu_envelope,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )

    raw_text = resp.text
    parsed: dict[str, Any] | None = None
    ct = (resp.headers.get("content-type") or "").lower()
    if "json" in ct or raw_text.lstrip().startswith(("{", "[")):
        try:
            parsed_any = resp.json()
        except (json.JSONDecodeError, ValueError):
            parsed = None
        else:
            # Only return dicts as parsed payloads. AA returns object-shape
            # JSON; an array would be unexpected and the caller can still
            # see raw_text.
            parsed = parsed_any if isinstance(parsed_any, dict) else None

    return resp.status_code, parsed, raw_text


async def wu_request_json(
    url: str,
    method: str = "GET",
    body: dict[str, Any] | str | None = None,
    headers: dict[str, str] | None = None,
    timeout_s: float = 210.0,
) -> tuple[int, dict[str, Any] | None]:
    """Make a WU request with `format: "json"` so BD wraps the target's
    response in a structured envelope — crucially including the target's
    response headers (Set-Cookie etc) which `format: "raw"` discards.

    Used for the AA two-step flow: GET the homepage to mint a session, read
    the Set-Cookie headers out of the envelope, then POST the API with those
    cookies (AA returns error 309 — "no session" — without them).

    Returns `(wu_http_status, envelope_or_None)`. BD's envelope shape is
    roughly `{"status_code": int, "headers": {...}, "body": "..."}` — but
    key names vary by BD API version, so callers should probe defensively.
    """
    token, zone = _read_wu_env()

    forwarded_headers = dict(headers or {})
    for hop_header in ("Host", "Content-Length", "host", "content-length"):
        forwarded_headers.pop(hop_header, None)

    wu_envelope: dict[str, Any] = {
        "zone": zone,
        "url": url,
        "method": method.upper(),
        "format": "json",
    }
    if body is not None:
        wu_envelope["body"] = json.dumps(body) if isinstance(body, dict) else body
    if forwarded_headers:
        wu_envelope["headers"] = forwarded_headers

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
        resp = await client.post(
            WU_ENDPOINT,
            json=wu_envelope,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )

    try:
        return resp.status_code, resp.json()
    except (json.JSONDecodeError, ValueError):
        return resp.status_code, None


async def wu_get(
    url: str,
    headers: dict[str, str] | None = None,
    timeout_s: float = 60.0,
) -> tuple[int, str]:
    """GET `url` via Bright Data Web Unlocker.

    Mostly used for diagnostics (verifying WU is alive, fetching HTML pages
    when an API endpoint isn't enough). Returns `(status_code, raw_text)` —
    no JSON parsing because WU GET is typically used against HTML pages
    where the response shape isn't known up front.

    HTML page fetches against bot-defended sites (e.g. aa.com homepage)
    historically time out at ~90s with `x-brd-error: captcha or protection
    page found` (Session 5, scraper-log.md L303) — WU's selector-wait
    detection has been stale for AA. The function will still return; the
    body just contains the BD error text.

    Args:
      url: Target URL.
      headers: Optional forwarded headers.
      timeout_s: Httpx deadline.

    Returns:
      `(status_code, raw_text)` — the target's status (via `format: "raw"`)
      and the verbatim response body.

    Raises:
      RuntimeError: env vars missing.
      httpx.HTTPError: network / timeout failure reaching `api.brightdata.com`.
    """
    token, zone = _read_wu_env()

    forwarded_headers = dict(headers or {})
    for hop_header in ("Host", "Content-Length", "host", "content-length"):
        forwarded_headers.pop(hop_header, None)

    wu_envelope: dict[str, Any] = {
        "zone": zone,
        "url": url,
        "method": "GET",
        "format": "raw",
    }
    if forwarded_headers:
        wu_envelope["headers"] = forwarded_headers

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10.0)) as client:
        resp = await client.post(
            WU_ENDPOINT,
            json=wu_envelope,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )

    return resp.status_code, resp.text
