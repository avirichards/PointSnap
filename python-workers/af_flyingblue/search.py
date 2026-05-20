"""Air France / KLM Flying Blue award search plugin — Bright Data Web Unlocker.

Phase 1 transport rewrite (2026-05-20). The prior transport (Patchright /
BD Browser API) is Akamai-flagged for the Flying Blue / Air France domains,
so the search silently returned `[]`. This module replaces it with the
Bright Data **Web Unlocker** (WU) transport and records a forensic trace.

=============================================================================
STATUS (2026-05-20): Flying Blue award search is `auth_required`. WU
bypasses the bot defense fine but CANNOT supply the logged-in session the
award search needs. The plugin returns `[]` with verdict `auth_required`
on every run — Flying Blue belongs to the T5' user-auth-capture path, not
to a WU scrape.

Investigation (all via `/diag/wu_probe` + direct WU calls, ~12 probes):

  * `GET https://wwws.airfrance.us/` → WU 200, 767 KB real homepage. WU
    clears Air France's Akamai for the homepage fine.
  * `GET https://wwws.airfrance.us/search/offers?...&awardBooking=true`
    (the award-results deep-link, Pattern B candidate) → WU **400**,
    `x-brd-error-code: ub_bad_endpoint_robots` — "Requested site is not
    available for immediate access mode in accordance with robots.txt."
    Bright Data's robots.txt-compliance mode blocks the Air France
    `/search/*` booking paths. The homepage is allowed; the booking deep
    link is not. Pattern B is therefore unavailable on airfrance.us.
  * `GET https://www.flyingblue.com/en/spend/flights/rewards` (+ every
    deeper path tried: `/rewards/search`, `/api/rewards/offers`,
    `/bff/rewards/search`) → WU 200 but ALWAYS the **same 150 KB Angular
    SPA shell** (`<kamino-root>` + `runtime/polyfills/main.js` + the
    `fb-breathing-animation` bootstrap loader). flyingblue.com is a
    pure client-rendered Angular app with a catch-all route: the server
    returns `index.html` for every path. There is NO server-side award
    API on flyingblue.com that WU can POST to (Pattern A unavailable).
  * The Angular shell embeds Akamai sensor.js (`/akam/13/pixel_*` +
    an obfuscated script path) and references `sso` — the award search
    XHR fires client-side from the booted Angular app, against a backend
    that requires a logged-in Flying Blue session. WU's `format=json`
    render returns the pre-bootstrap shell, before Angular mounts or
    fires any award XHR — so even the in-page render path yields no rows.
  * `api.airfranceklm.com` (the official AF/KL developer API) → WU 502
    `596 status` — needs a registered API key, not a scrape target.

Agent 5 (auth-viability research) independently confirms: Flying Blue's
"Book with Miles" tab requires login; anonymous users hit a login wall.
T5' priority HIGH.

CONCLUSION: there is no anonymous, server-rendered Flying Blue award
endpoint for WU to reach. The award search is an authenticated Angular
SPA. This plugin stays wired so `/diag/run_plugin` captures a forensic
trace, and returns `[]` (verdict `auth_required`) until the T5'
user-auth path supplies a logged-in cookie jar.
=============================================================================

Defensive contract: `search()` never raises — every failure path returns
`[]` and records a verdict in `LAST_RUN_DIAG`.

No new env vars beyond `BRIGHTDATA_WU_TOKEN` / `BRIGHTDATA_WU_ZONE`
(both read by `common/bd_wu.py`).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from common.bd_wu import wu_request_json
from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "AF_FLYINGBLUE"
PROGRAM_NAME = "Flying Blue"

# The Flying Blue rewards SPA. WU renders the Angular shell here (200, but
# only the pre-bootstrap loader — no award rows). Probed as a liveness
# signal so LAST_RUN_DIAG records whether WU still reaches the host.
REWARDS_SPA_URL = "https://www.flyingblue.com/en/spend/flights/rewards"

# Module-level diagnostic state — exposed via `/diag/run_plugin`. Forensic
# by design (CLAUDE.md scraper-log discipline): a caller should never have
# to grep Fly logs to learn what happened — LAST_RUN_DIAG should answer it.
LAST_RUN_DIAG: dict[str, Any] = {"attempts": []}


def _parse(payload: Any, origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Parse a Flying Blue award response into NormalizedResult[].

    Kept intact for the day the T5' user-auth path supplies a logged-in
    session and a real award payload reaches this function. Flying Blue's
    award offers are a list under `flights` / `calendar` / `offers`, each
    carrying per-cabin miles + EUR taxes. Robust to missing keys: any
    offer that fails to parse is skipped, not fatal.
    """
    results: list[NormalizedResult] = []
    flights = (
        payload.get("flights") or payload.get("calendar") or payload.get("offers") or []
    ) if isinstance(payload, dict) else []
    for f in flights[:6]:
        try:
            cabin_prices: list[CabinPrice] = []
            for cabin_code in ("Y", "W", "J", "F"):
                miles_obj = (f.get("prices") or f.get("cabins") or {}).get(cabin_code)
                if not miles_obj:
                    continue
                miles = miles_obj if isinstance(miles_obj, int) else miles_obj.get("miles", 0)
                if not miles:
                    continue
                taxes_eur = miles_obj.get("taxes", 0) if isinstance(miles_obj, dict) else 0
                cabin_prices.append(
                    CabinPrice(
                        cabin=cabin_code,  # type: ignore[arg-type]
                        seats_remaining=0,
                        miles_per_pax=int(miles),
                        surcharge_usd_per_pax=int(round(float(taxes_eur) * 1.1)),  # EUR→USD rough
                        taxes_usd_per_pax=0,
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
                    total_duration_min=0,
                    num_segments=1,
                    segments=[
                        ResultSegment(
                            segment_order=0,
                            operating_airline_iata=f.get("carrier") or "AF",
                            marketing_airline_iata="AF",
                            flight_number=str(f.get("flightNumber") or ""),
                            origin_iata=origin,
                            dest_iata=dest,
                            depart_at=f"{date}T00:00:00Z",
                            arrive_at=f"{date}T00:00:00Z",
                            aircraft_icao=None,
                            segment_cabin=None,
                            fare_class=None,
                        )
                    ],
                    cabin_prices=cabin_prices,
                    confidence_score=67,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("AF parse error: %s", exc)
            continue
    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",  # noqa: ARG001 — keep signature parity
) -> list[NormalizedResult]:
    """Flying Blue award search — `auth_required`, returns `[]`.

    See the module docstring for the full investigation. In short: Flying
    Blue's award search is an authenticated Angular SPA. WU clears the bot
    defense (the rewards SPA renders 200) but cannot run the Angular app
    to completion, fire its award XHR, or supply the logged-in Flying Blue
    session the award backend requires. There is no anonymous server-side
    award endpoint to POST to. This is a T5' user-auth-path program.

    This function still does one WU GET of the rewards SPA so
    `LAST_RUN_DIAG` records whether WU currently reaches the host (vs. a
    transport regression), then returns `[]` with verdict `auth_required`.

    Verdict codes recorded in `LAST_RUN_DIAG["last_verdict"]`:
      auth_required — expected terminal state: Flying Blue needs a logged-in
                      session WU cannot supply (the rewards SPA may render
                      or not — either way no rows without auth)
      http_error    — network/timeout error reaching api.brightdata.com
      crash         — unhandled exception (programmer error)
    """
    global LAST_RUN_DIAG
    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transport": "bd_web_unlocker",
        "origin": origin,
        "dest": dest,
        "date": date,
        "rewards_spa_url": REWARDS_SPA_URL,
        "note": (
            "Flying Blue award search is an authenticated Angular SPA. WU "
            "bypasses the bot defense but cannot supply the logged-in "
            "session the award backend needs, and there is no anonymous "
            "server-side award endpoint. Routed to the T5' user-auth path."
        ),
        "attempts": [],
    }
    print(
        f"AF: ===== search start {origin}->{dest} {date} (auth_required) =====",
        flush=True,
    )

    attempt: dict[str, Any] = {"stage": "rewards_spa_probe", "url": REWARDS_SPA_URL}
    try:
        status, envelope = await wu_request_json(REWARDS_SPA_URL, method="GET")
        attempt["wu_http_status"] = status
        if isinstance(envelope, dict):
            attempt["target_status"] = (
                envelope.get("status_code") or envelope.get("status")
            )
            body = envelope.get("body")
            if isinstance(body, str):
                attempt["body_len"] = len(body)
                # The Angular bootstrap shell — not an award payload. Recorded
                # so a future session sees WU still returns the SPA shell.
                attempt["is_angular_shell"] = "kamino-root" in body
                attempt["has_akamai_sensor"] = "/akam/" in body
            hdrs = envelope.get("headers") or envelope.get("response_headers") or {}
            if isinstance(hdrs, dict):
                attempt["x_brd_error"] = hdrs.get("x-brd-error") or hdrs.get("X-Brd-Error")
    except httpx.HTTPError as exc:
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"AF: rewards SPA probe httpx error: {err}", flush=True)
        attempt.update(stage="probe_http_error", error=err)
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "http_error"
        LAST_RUN_DIAG["row_count"] = 0
        return []
    except Exception as exc:  # noqa: BLE001
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"AF: rewards SPA probe crash: {err}", flush=True)
        attempt.update(stage="probe_crash", error=err)
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "crash"
        LAST_RUN_DIAG["row_count"] = 0
        return []

    attempt["verdict"] = "auth_required"
    LAST_RUN_DIAG["attempts"].append(attempt)
    LAST_RUN_DIAG["last_verdict"] = "auth_required"
    LAST_RUN_DIAG["row_count"] = 0
    print(
        f"AF: rewards SPA probe → wu={attempt.get('wu_http_status')} "
        f"target={attempt.get('target_status')} "
        f"angular_shell={attempt.get('is_angular_shell')} — "
        f"auth_required, returning [] (T5' user-auth path)",
        flush=True,
    )
    return []


search = _scrape_real
