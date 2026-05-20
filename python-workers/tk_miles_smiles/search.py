"""Turkish Miles&Smiles award search plugin — Bright Data Web Unlocker.

Phase 1 transport rewrite (2026-05-20). The prior transport (Patchright /
BD Browser API) was Akamai-flagged and silently returned `[]`. This module
replaces it with the Bright Data **Web Unlocker** (WU) transport and
records a forensic trace.

=============================================================================
STATUS (2026-05-20): Turkish Miles&Smiles award search is `auth_required`.
WU partially clears the bot defense but CANNOT supply the logged-in
Miles&Smiles session the award search needs. The plugin returns `[]` with
verdict `auth_required` on every run — Miles&Smiles belongs to the T5'
user-auth path, not to a WU scrape.

Investigation (all via `/diag/wu_probe` + direct WU calls, ~14 probes):

  * `GET https://www.turkishairlines.com/en-int/` → WU 200, 7.8 KB
    Next.js shell. The site is a Next.js app (`/_next/static`,
    `_buildManifest.js`, buildId `rZaJkYk8LSM9-seDxC6WT`) with TK's own
    `human-bot-protection.js` + Akamai mPulse (`BOOMR`).
  * `GET https://www.turkishairlines.com/en-int/flights/booking/` → WU
    200, 12.6 KB — the cash booking entry page. The "award" mentions in
    it are FAQ schema markup ("How can I buy an Award ticket with my
    Miles?"), NOT an award search UI. The page embeds Akamai sensor.js
    (`/akam/13/...`). Its `__NEXT_DATA__` is `page:"/flightticket"`,
    `__N_SSP:true` — the flight-results page is server-rendered, but with
    no search params `pageProps` is `{}`.
  * `GET https://www.turkishairlines.com/en-int/flights/booking/availability/`
    → WU 200 but the body is **Turkish Airlines' own Akamai block page**
    ("Take a short break from your passion for travel! ... you are not
    able to access our site right now" + an Akamai `Reference Code`). WU
    gets TK's homepage/marketing pages but the booking-availability path
    is soft-denied even through WU's unlocker.
  * Probed booking-results route variants (`/flightticket`,
    `/flights/booking/flightticket/`, with full award search params) →
    all **404** (`pageProps:{statusCode}`). TK's award-results route is
    a deeper step inside the booking wizard, not a guessable deep-link.
  * `GET https://www.turkishairlines.com/en-int/miles-and-smiles/` → WU
    200, 116 KB — the Miles&Smiles landing page (marketing copy + an
    embedded login widget: body has `password` / `award` / `miles`). The
    actual award search sits behind that login.

Agent 5 (auth-viability research) independently confirms: Turkish
Miles&Smiles "must sign in to access award search engine." T5' priority
HIGH. (There is also an official Turkish Airlines developer API —
`strawb3rryx7/tkapi` uses `getAvailability` — but that needs a registered
API key + secret, out of scope for a WU scrape.)

CONCLUSION: WU reaches TK's static / marketing pages, but the award
booking path is both Akamai-walled (TK's own block page) and login-gated
behind a Miles&Smiles member session. There is no anonymous,
server-rendered award endpoint for WU to reach. This plugin stays wired
so `/diag/run_plugin` captures a forensic trace, and returns `[]`
(verdict `auth_required`) until the T5' user-auth path supplies a
logged-in cookie jar.
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
PROGRAM_ID = "TK_MILES_SMILES"
PROGRAM_NAME = "Turkish Miles&Smiles"

# The Turkish Airlines booking entry page. WU renders it (200) — it is the
# cash booking entry; the Miles&Smiles award search is login-gated and the
# deeper /availability/ path is Akamai-blocked. Probed as a liveness signal
# so LAST_RUN_DIAG records whether WU still reaches the host.
BOOKING_ENTRY_URL = "https://www.turkishairlines.com/en-int/flights/booking/"

# Module-level diagnostic state — exposed via `/diag/run_plugin`. Forensic
# by design (CLAUDE.md scraper-log discipline).
LAST_RUN_DIAG: dict[str, Any] = {"attempts": []}


def _parse(payload: Any, origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Parse a Turkish Miles&Smiles award response into NormalizedResult[].

    Kept intact for the day the T5' user-auth path supplies a logged-in
    session and a real award payload reaches this function. TK award
    offers are a list under `availabilities` / `offers` / `flights`, each
    carrying per-cabin miles + taxes. Robust to missing keys: any offer
    that fails to parse is skipped, not fatal.
    """
    results: list[NormalizedResult] = []
    items = (
        payload.get("availabilities") or payload.get("offers") or payload.get("flights") or []
    ) if isinstance(payload, dict) else []
    for it in items[:6]:
        try:
            cabin_prices: list[CabinPrice] = []
            for cabin_key, cab in (("economy", "Y"), ("business", "J"), ("first", "F")):
                price_obj = (it.get("prices") or it.get("cabins") or {}).get(cabin_key) or {}
                miles = price_obj.get("miles") if isinstance(price_obj, dict) else price_obj
                if not miles:
                    continue
                cabin_prices.append(
                    CabinPrice(
                        cabin=cab,  # type: ignore[arg-type]
                        seats_remaining=0,
                        miles_per_pax=int(miles),
                        surcharge_usd_per_pax=0,
                        taxes_usd_per_pax=(
                            int(round(float(price_obj.get("taxes") or 0)))
                            if isinstance(price_obj, dict)
                            else 0
                        ),
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
                            operating_airline_iata="TK",
                            marketing_airline_iata="TK",
                            flight_number=str(it.get("flightNumber") or ""),
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
                    confidence_score=38,  # phantom-prone — keep low until two-step verify lands
                    observed_at=now,
                    last_seen_at=now,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("TK parse error: %s", exc)
            continue
    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",  # noqa: ARG001 — keep signature parity
) -> list[NormalizedResult]:
    """Turkish Miles&Smiles award search — `auth_required`, returns `[]`.

    See the module docstring for the full investigation. In short: WU
    reaches Turkish Airlines' static / marketing pages, but the award
    booking path is both Akamai-walled (TK serves its own block page on
    `/flights/booking/availability/` even through WU) and login-gated
    behind a Miles&Smiles member session. There is no anonymous,
    server-rendered award endpoint. This is a T5' user-auth-path program.

    This function still does one WU GET of the booking entry page so
    `LAST_RUN_DIAG` records whether WU currently reaches the host (vs. a
    transport regression), then returns `[]` with verdict `auth_required`.

    Verdict codes recorded in `LAST_RUN_DIAG["last_verdict"]`:
      auth_required — expected terminal state: Miles&Smiles needs a
                      logged-in member session WU cannot supply
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
        "booking_entry_url": BOOKING_ENTRY_URL,
        "note": (
            "Turkish Miles&Smiles award search requires a logged-in member "
            "session. WU reaches TK's static pages but the award booking "
            "path is Akamai-walled (TK's own block page) and login-gated. "
            "No anonymous server-side award endpoint. Routed to the T5' "
            "user-auth path."
        ),
        "attempts": [],
    }
    print(
        f"TK: ===== search start {origin}->{dest} {date} (auth_required) =====",
        flush=True,
    )

    attempt: dict[str, Any] = {"stage": "booking_entry_probe", "url": BOOKING_ENTRY_URL}
    try:
        status, envelope = await wu_request_json(BOOKING_ENTRY_URL, method="GET")
        attempt["wu_http_status"] = status
        if isinstance(envelope, dict):
            attempt["target_status"] = (
                envelope.get("status_code") or envelope.get("status")
            )
            body = envelope.get("body")
            if isinstance(body, str):
                attempt["body_len"] = len(body)
                # TK serves its own Akamai block page on protected paths —
                # recorded so a future session can tell a render from a deny.
                attempt["is_tk_block_page"] = (
                    "short break" in body or "not able to access" in body
                )
                attempt["has_akamai_sensor"] = "/akam/" in body
            hdrs = envelope.get("headers") or envelope.get("response_headers") or {}
            if isinstance(hdrs, dict):
                attempt["x_brd_error"] = hdrs.get("x-brd-error") or hdrs.get("X-Brd-Error")
    except httpx.HTTPError as exc:
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"TK: booking entry probe httpx error: {err}", flush=True)
        attempt.update(stage="probe_http_error", error=err)
        LAST_RUN_DIAG["attempts"].append(attempt)
        LAST_RUN_DIAG["last_verdict"] = "http_error"
        LAST_RUN_DIAG["row_count"] = 0
        return []
    except Exception as exc:  # noqa: BLE001
        err = f"{type(exc).__name__}: {str(exc)[:300]}"
        print(f"TK: booking entry probe crash: {err}", flush=True)
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
        f"TK: booking entry probe → wu={attempt.get('wu_http_status')} "
        f"target={attempt.get('target_status')} "
        f"tk_block={attempt.get('is_tk_block_page')} — "
        f"auth_required, returning [] (T5' user-auth path)",
        flush=True,
    )
    return []


search = _scrape_real
