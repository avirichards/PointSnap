"""Air Canada Aeroplan award search plugin — auth_required (T5' path).

Phase-1 transport investigation (2026-05-20). The prior transport
(Patchright + BD Browser API) is Akamai-flagged for aircanada.com, so the
search silently returned `[]`. This module was slated for a Bright Data
Web Unlocker rewrite — but the investigation below shows Aeroplan award
search is gated behind a **logged-in Aeroplan session** (Air Canada built
this login wall in March 2025 expressly to stop award scrapers), so no
anonymous WU transport returns rows. The plugin is left as an honest
`auth_required` stub.

=============================================================================
INVESTIGATION FINDINGS (2026-05-20, all via `/diag/wu_probe`, format=json):

  GOOD NEWS — the WU transport itself is viable for Air Canada:
  * `GET aircanada.com/` → 200, 56 KB, full Akamai jar (`_abck`, `bm_s`).
  * `GET .../aeroplan/redeem/availability/outbound?org0=...&dest0=...&
       departureDate0=...&marketCode=TNB`
      → 200, 62 KB. The real Angular redemption SPA shell
      (`<title>AC Loyalty</title>`, `<base href="/aeroplan/redeem/">`),
      with a full Akamai jar: `_abck`, `bm_ss`, `bm_so`, `bm_sz`, `AKA_A2`.
      NO server-side login redirect (`x-unblocker-redirected-to` absent).
      WU fully clears Air Canada's Akamai for the page GET.
  * `POST .../loyalty/dapidynamic/{tenant}/v2/search/air-bounds`
      → target_status **404** (AC's generic not-found page), NOT an
      Akamai 444 edge-reject and NOT a BD `bad_endpoint_robots` block.
      So WU *can* POST to the `loyalty/dapidynamic/*` API path — the 404
      is only because the `{tenant}` path segment is a specific value
      that could not be guessed (tried `1ASIATSAC`, `1ASIDFPAC`,
      `loyalty`, `airbounds` — all 404). The real tenant id is baked
      into the redeem SPA's Angular JS bundle.

  THE BLOCKER — auth (matches Agent 5's research, flagged CRITICAL):
  Air Canada built a **login wall in March 2025**, explicitly to stop
  award scrapers (it had sued seats.aero, which scraped the air-bounds
  API anonymously). Aeroplan award search now requires a logged-in
  Aeroplan account session. The redeem SPA *shell* still renders without
  a session (the page GET above is 200), but the SPA's air-bounds XHR —
  the call that actually returns award availability + miles pricing — is
  gated behind that logged-in session. Bright Data Web Unlocker bypasses
  Air Canada's Akamai bot defense, but it is a stateless single-shot
  fetch and **cannot supply a logged-in Aeroplan account**.

CONCLUSION — auth_required:
  This is NOT a WU/transport bug and NOT something a code change fixes.
  Aeroplan belongs to the **T5' user-auth-capture** path (a sibling
  workstream is building it) — Agent 5 rates AC the #1 T5'-required
  airline ("T5' is the ONLY way to scrape Aeroplan post-March-2025").
  Per the scraping briefing, a broken plugin must NOT be forced — so
  `search()` here returns `[]` with verdict `auth_required`.

  HANDOFF for the T5' transport — this plugin is *close* to working:
  the WU transport is already proven viable for Air Canada (page renders,
  Akamai cleared, `dapidynamic/*` POST reachable). T5' needs only two
  things to flip this plugin to a real WU 2-step:
    1. A logged-in Aeroplan cookie jar (the T5' session capture), to be
       forwarded as a `Cookie:` header on the air-bounds POST.
    2. The `{tenant}` path segment + exact request-body shape, extracted
       from the redeem SPA's Angular JS bundle (or captured from a real
       logged-in browser's air-bounds XHR during the T5' capture).
  `_parse_air_bounds()` below — the AwardWiz-derived response parser — is
  kept fully intact and ready, so only the transport needs wiring.
=============================================================================

Defensive contract: `search()` never raises — it returns `[]` and records
a verdict in `LAST_RUN_DIAG`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from common.auth_session import get_active_session, mark_used
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "AC_AEROPLAN"
PROGRAM_NAME = "Aeroplan"

# Reference URLs / paths (kept for the T5' transport that replaces this stub).
WARMUP_URL = "https://www.aircanada.com/"
SEARCH_PAGE_TMPL = (
    "https://www.aircanada.com/aeroplan/redeem/availability/outbound"
    "?org0={origin}&dest0={dest}&departureDate0={date}"
    "&lang=en-CA&tripType=O&ADT=1&YTH=0&CHD=0&INF=0&INS=0&marketCode=TNB"
)
# The award API; `{tenant}` is a specific path segment baked into the
# redeem SPA's JS bundle (see docstring — must be extracted for T5').
AIR_BOUNDS_PATH = "/v2/search/air-bounds"

# Module-level diagnostic state — exposed for the parent's consolidated
# deploy/test. Forensic-detail by design (CLAUDE.md scraper log discipline).
LAST_RUN_DIAG: dict[str, Any] = {}


def _cabin_from_ac(code: str) -> str | None:
    """Map an Air Canada cabin code to our cabin enum.

    AC's air-bounds response uses `eco` / `ecoPremium` / `business` /
    `first`. Kept for the T5' transport's parse step.
    """
    return {
        "eco": "Y",
        "ecoPremium": "W",
        "business": "J",
        "first": "F",
    }.get(code)


def _parse_air_bounds(payload: dict[str, Any], origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Parse Air Canada's air-bounds award response into NormalizedResult[].

    Shape ported from lg/awardwiz aeroplan.ts: `data.airBoundGroups[]` with
    `boundDetails.segments` (resolved via `data.dictionaries.flight`) and
    `airBounds[].prices.milesConversion.convertedMiles`. Kept fully intact
    and ready for the T5' (logged-in) transport. Robust to missing keys:
    any group that fails to parse is skipped, not fatal. Not exercised by
    the current `auth_required` stub.
    """
    results: list[NormalizedResult] = []
    data = payload.get("data") or {}
    groups = data.get("airBoundGroups") or []
    flight_dict = (data.get("dictionaries") or {}).get("flight") or {}

    for grp in groups[:6]:  # cap top 6 itineraries
        try:
            bound = (grp.get("boundDetails") or {})
            seg_ids = bound.get("segments") or []
            segments: list[ResultSegment] = []
            for i, seg_ref in enumerate(seg_ids):
                fid = seg_ref.get("flightId") if isinstance(seg_ref, dict) else seg_ref
                f = flight_dict.get(fid) or {}
                segments.append(
                    ResultSegment(
                        segment_order=i,
                        operating_airline_iata=(f.get("operatingAirline") or {}).get("code") or "AC",
                        marketing_airline_iata=(f.get("marketingAirline") or {}).get("code") or "AC",
                        flight_number=str(f.get("number") or ""),
                        origin_iata=(f.get("origin") or {}).get("locationCode") or origin,
                        dest_iata=(f.get("destination") or {}).get("locationCode") or dest,
                        depart_at=(f.get("departure") or {}).get("dateTime") or f"{date}T00:00:00Z",
                        arrive_at=(f.get("arrival") or {}).get("dateTime") or f"{date}T00:00:00Z",
                        aircraft_icao=(f.get("aircraft") or {}).get("code"),
                        segment_cabin=None,
                        fare_class=None,
                    )
                )

            cabin_prices: list[CabinPrice] = []
            for air_bound in grp.get("airBounds") or []:
                cabin_code = _cabin_from_ac(air_bound.get("availabilityDetails", [{}])[0].get("cabin") or "")
                if not cabin_code:
                    continue
                prices = air_bound.get("prices") or {}
                miles_obj = (prices.get("milesConversion") or {}).get("convertedMiles") or {}
                miles = int(miles_obj.get("base") or 0)
                taxes_cents = int(prices.get("totalTaxes") or 0)
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin_code,  # type: ignore[arg-type]
                        seats_remaining=int(air_bound.get("availabilityDetails", [{}])[0].get("quota") or 0),
                        miles_per_pax=miles,
                        surcharge_usd_per_pax=0,  # AC doesn't pass YQ
                        taxes_usd_per_pax=int(round(taxes_cents / 100.0)),
                    )
                )
            if not cabin_prices:
                continue

            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            results.append(
                NormalizedResult(
                    program_id=PROGRAM_ID,
                    program_name=PROGRAM_NAME,
                    origin_iata=origin,
                    dest_iata=dest,
                    depart_date=date,
                    arrive_date=date,
                    total_duration_min=int(bound.get("duration") or 0),
                    num_segments=len(segments),
                    segments=segments,
                    cabin_prices=cabin_prices,
                    confidence_score=81,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("AC airBoundGroup parse error: %s", exc)
            continue

    return results


def _cookie_header(cookies: list[dict]) -> str:
    """Build a `Cookie:` header value from stored Playwright-shape cookies.

    The T5' capture stores cookies in Playwright's shape (name/value/domain/
    path/...). For a WU `Cookie:` header we only need `name=value` pairs;
    we keep every cookie (domain scoping is the target's problem, and AC's
    jar is all `aircanada.com`).
    """
    parts = [
        f"{c['name']}={c['value']}"
        for c in cookies
        if c.get("name") and c.get("value") is not None
    ]
    return "; ".join(parts)


async def _auth_search(
    user_id: str,
    origin: str,
    dest: str,
    date: str,
) -> list[NormalizedResult]:
    """T5' auth path — Aeroplan award search with the user's captured
    logged-in session.

    This is the hook the Phase 2.5 user-auth-capture flow feeds. Steps:

      1. Look up the user's stored Aeroplan session (the encrypted cookie
         jar captured when they logged in via the cockpit `/airlines`
         flow) via `get_active_session`.
      2. If no session (or it expired): fall through to the `auth_required`
         verdict — the cockpit shows a "Connect Air Canada" prompt.
      3. If a session exists: replay the logged-in cookie jar as a
         `Cookie:` header on the air-bounds API call (Web Unlocker clears
         Air Canada's Akamai; the cookie jar supplies the logged-in
         Aeroplan account that the March-2025 login wall demands).

    TRANSPORT SEAM — the air-bounds POST needs two facts the T5' capture
    does not yet hand us (see this module's header docstring): the
    `{tenant}` path segment baked into the redeem SPA's Angular bundle, and
    the exact request-body shape. Until those are captured, the POST 404s
    on the unknown tenant. The cookie-injection hook itself is real and
    correct: when a future session capture records the tenant + body, this
    function flips to a working WU 2-step with no structural change —
    `_parse_air_bounds` is already wired to consume the response.

    Records a verdict in `LAST_RUN_DIAG` and never raises.
    """
    global LAST_RUN_DIAG
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    session = await get_active_session(user_id, PROGRAM_ID)
    if not session:
        # No captured session — honest auth_required (same as anon path).
        LAST_RUN_DIAG = {
            "started_at": now_iso,
            "transport": "auth_lookup",
            "origin": origin,
            "dest": dest,
            "date": date,
            "user_id": user_id,
            "last_verdict": "auth_required",
            "row_count": 0,
            "note": (
                "No active program_auth_sessions row for this user — the "
                "user has not connected Air Canada (or the session "
                "expired). Cockpit shows the Connect Air Canada prompt."
            ),
        }
        print(
            f"AC: ===== {origin}->{dest} {date} — auth_required "
            f"(no session for user {user_id}) =====",
            flush=True,
        )
        return []

    cookies = session.get("cookies") or []
    cookie_header = _cookie_header(cookies)
    session_id = session.get("session_id")

    # We have the user's logged-in jar. Attempt the air-bounds call.
    rows: list[NormalizedResult] = []
    transport_ok = False
    target_status: int | None = None
    try:
        from common.bd_wu import wu_post

        # The redeem-SPA air-bounds API. `{tenant}` is the unresolved seam
        # (see docstring) — kept as a clearly-flagged placeholder so a
        # future capture only edits this one constant.
        air_bounds_url = (
            "https://www.aircanada.com/loyalty/dapidynamic/"
            "1ASIATSAC/v2/search/air-bounds"
        )
        # Minimal AwardWiz-derived body. The real shape is captured during
        # a logged-in air-bounds XHR — this is the documented skeleton.
        body = {
            "origin": origin,
            "destination": dest,
            "date": date,
            "cabinClass": "eco",
            "passengers": {"adults": 1, "youth": 0, "children": 0, "infants": 0},
        }
        status, parsed, raw = await wu_post(
            air_bounds_url,
            body,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Cookie": cookie_header,
                "Referer": SEARCH_PAGE_TMPL.format(origin=origin, dest=dest, date=date),
            },
            timeout_s=60.0,
        )
        target_status = status
        if status == 200 and isinstance(parsed, dict):
            rows = _parse_air_bounds(parsed, origin, dest, date)
            transport_ok = True
    except Exception as exc:  # noqa: BLE001 — never raise out of a plugin
        log.warning("AC auth-search transport error: %s", exc)

    # Record the outcome against the session so the cockpit can surface a
    # "reconnect" hint if the cookies stopped working.
    if session_id:
        try:
            await mark_used(session_id, ok=bool(rows))
        except Exception as exc:  # noqa: BLE001
            log.debug("AC mark_used failed: %s", exc)

    verdict = (
        "ok"
        if rows
        else ("auth_session_present_transport_pending" if transport_ok or target_status else "auth_failed")
    )
    LAST_RUN_DIAG = {
        "started_at": now_iso,
        "transport": "wu_2step_auth",
        "origin": origin,
        "dest": dest,
        "date": date,
        "user_id": user_id,
        "auth_session_id": session_id,
        "cookie_count": len(cookies),
        "air_bounds_target_status": target_status,
        "last_verdict": verdict,
        "row_count": len(rows),
        "note": (
            "Captured Aeroplan session found and replayed. "
            + (
                f"Parsed {len(rows)} award itineraries."
                if rows
                else (
                    "Air-bounds POST reached but returned no parseable "
                    "award data — the {tenant} path segment + request-body "
                    "shape still need to be captured from a logged-in "
                    "air-bounds XHR (see module docstring). The "
                    "cookie-injection hook is wired and correct; only the "
                    "transport's tenant/body constants remain."
                )
            )
        ),
    }
    print(
        f"AC: ===== {origin}->{dest} {date} — auth path, verdict={verdict}, "
        f"rows={len(rows)} =====",
        flush=True,
    )
    return rows


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",  # noqa: ARG001 — keep signature parity
    user_id: str | None = None,
) -> list[NormalizedResult]:
    """Air Canada Aeroplan award search.

    Aeroplan award search requires a logged-in Aeroplan account session
    (Air Canada's March-2025 anti-scraper login wall — Agent 5 research +
    the 2026-05-20 `/diag/wu_probe` investigation in this module's
    docstring). There is no anonymous transport that returns real rows.

    Dispatch:
      * `user_id` present → `_auth_search`: look up the user's captured
        T5' session and replay the logged-in cookie jar (Phase 2.5).
      * `user_id` absent  → no session to use; records verdict
        `auth_required` in `LAST_RUN_DIAG` and returns `[]`. The cockpit
        surfaces a "Connect Air Canada" prompt via `/airlines`.

    Never raises — always returns a list.
    """
    global LAST_RUN_DIAG

    if user_id:
        return await _auth_search(user_id, origin, dest, date)

    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transport": "none",
        "origin": origin,
        "dest": dest,
        "date": date,
        "last_verdict": "auth_required",
        "row_count": 0,
        "note": (
            "Aeroplan award search requires a logged-in Aeroplan session "
            "(Air Canada's March-2025 anti-scraper login wall). No user_id "
            "was supplied, so there is no captured T5' session to replay. "
            "WU clears Air Canada's Akamai and CAN reach the "
            "loyalty/dapidynamic/* air-bounds API path, but cannot supply "
            "a logged-in Aeroplan account on its own. Connect Air Canada "
            "via the cockpit /airlines page to enable this search."
        ),
        "reference": {
            "warmup_url": WARMUP_URL,
            "search_page": SEARCH_PAGE_TMPL.format(origin=origin, dest=dest, date=date),
            "air_bounds_path_suffix": AIR_BOUNDS_PATH,
        },
    }
    print(
        f"AC: ===== {origin}->{dest} {date} — auth_required, "
        f"returning [] (no user_id; T5' path) =====",
        flush=True,
    )
    return []


search = _scrape_real
