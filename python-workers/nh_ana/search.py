"""ANA Mileage Club award search plugin — AUTH-REQUIRED, returns [].

=============================================================================
STATUS (2026-05-21): ANA partner-award search is treated as LOGIN-GATED. The
plugin returns `[]` cleanly with `LAST_RUN_DIAG["verdict"] == "auth_required"`
and belongs on the **T5' user-auth-capture path**, not the WU-grind path.

This classification is deliberate, and the evidence is mixed — read on so the
T5' implementer has the full picture.

What the live WU probes showed (`/diag/wu_probe`, 2026-05-21):

  * `GET https://aswbe-i.ana.co.jp/international_asw/pages/award/search/
    roundtrip/award_search_roundtrip_input.xhtml?CONNECTION_KIND=JPN&LANG=en`
    via WU → **200, a 40,716-byte fully-rendered JSF page**. The body is the
    ANA international award-search INPUT FORM itself (JSF / JavaServer Faces;
    `<!-- skey = ... -->` session marker, Dynatrace `ruxitagentjs` injected).
    WU clears Akamai (cookie jar: `asw_uuid`, `bm_*`) and follows a routing
    redirect that lands on the form — NOT on a login page.
  * A WU `POST` to the same `.xhtml` URL → the SAME 40,716-byte input form
    re-rendered (fresh `skey`). That is standard JSF behaviour for a POST
    that lacks a valid `javax.faces.ViewState` — JSF rebuilds the view
    rather than processing a search. Notably it does NOT bounce to login.

So the award-search input form *renders anonymously*. That is necessary but
NOT sufficient to call ANA "anonymous-search-capable". Two hard reasons it is
still classified `auth_required`:

  1. ANA award search is a stateful multi-step JSF flow. A real search is a
     `javax.faces.partial.ajax` POST back to the `.xhtml` carrying the
     `javax.faces.ViewState` token, the JSF-generated component IDs of every
     `requestedSegment` field, and `javax.faces.source/execute/render`
     wiring — all extracted from the input-page HTML. The deployed
     `/diag/wu_probe` endpoint caps the response body at 800 chars, so the
     form's actual field names and ViewState could NOT be read during this
     investigation. Building the JSF POST blind would be guesswork.
  2. ANA's *partner* (Star Alliance) award availability — the valuable
     content — has historically required a logged-in AMC member session
     even when the input form renders. Agent 5 (auth-viability research)
     states "NH ANA — explicit redirect to login page for award search /
     availability calendar." The prior plugin and the flightplan-tool `nh`
     engine it was ported from BOTH perform a credentialed AMC login
     (`accountNumber` + password, `#amcMemberLogin`) before searching. Two
     independent OSS scrapers gating this behind login is a strong signal.

Net: the input form being anonymous does not prove an anonymous *search*
works, and a blind JSF ViewState POST against a likely member-gated flow is
exactly the kind of thing not to force. ANA goes to T5'.

LEAD FOR THE T5' IMPLEMENTER: the `aswbe-i.ana.co.jp` award-search host is
itself Akamai-clearable via WU (the form renders, `asw_uuid` mints). The open
question is purely whether the JSF *search submit* needs the AMC session. The
fastest way to settle it: capture a logged-in AMC session, then either (a)
drive the JSF form in a real browser, or (b) WU-GET the input page to harvest
`javax.faces.ViewState` + component IDs (read the FULL body, not via the
800-char-capped probe), then WU-POST the partial-ajax search with the
logged-in cookie jar. `_parse_results_html()` below is kept intact to parse
the JSF results HTML once a working transport exists.
=============================================================================

Defensive contract: `search()` never raises — it returns `[]` and records
`LAST_RUN_DIAG["verdict"] == "auth_required"`.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

from common.types import CabinPrice, NormalizedResult, ResultSegment

log = logging.getLogger(__name__)
PROGRAM_ID = "NH_ANA"
PROGRAM_NAME = "ANA Mileage Club"

# The JSF award-search host + input page. WU CAN render the input page
# (200, 40 KB) and mint `asw_uuid` — recorded here for the future T5'
# auth-capture work. Not driven by this WU-grind plugin (the JSF search
# submit is treated as member-gated; see module docstring).
AWARD_LOGIN_URL = "https://www.ana.co.jp/en/us/amc/"
AWARD_SEARCH_INPUT_URL = (
    "https://aswbe-i.ana.co.jp/international_asw/pages/award/search/"
    "roundtrip/award_search_roundtrip_input.xhtml?CONNECTION_KIND=JPN&LANG=en"
)

# Module-level forensic state (CLAUDE.md scraper-log discipline). No
# `/diag/nh_last` route is wired in serve.py — this dict remains the single
# source of truth for "what did the last NH run do".
LAST_RUN_DIAG: dict[str, Any] = {
    "verdict": "auth_required",
    "note": (
        "ANA award-search JSF input form renders anonymously via WU (200, "
        "40 KB) but the partner-award search submit is treated as AMC "
        "member-gated (Agent 5 + flightplan-tool + prior plugin all require "
        "login). JSF ViewState/component IDs un-readable via the 800-char "
        "wu_probe cap. Route to T5' user-auth-capture. See module docstring."
    ),
}


def _parse_results_html(html: str, origin: str, dest: str, date: str) -> list[NormalizedResult]:
    """Parse ANA's JSF results HTML into NormalizedResult[].

    Best-effort regex extraction — ANA's JSF generates synthetic element IDs,
    so selectors are brittle: selectolax locates the itinerary table, regex
    pulls the fare-class miles. Kept intact for the future T5' auth-capture
    path (the JSF results page is HTML, not a JSON XHR). Not called on the
    anonymous WU-grind path (which returns []).
    """
    try:
        from selectolax.parser import HTMLParser
    except ImportError:
        return []

    tree = HTMLParser(html)
    results: list[NormalizedResult] = []
    # ANA renders one outbound row per option, with cells for FS/CS/WS/YS
    # showing miles cost. Selectors are brittle — look for any table with a
    # known ANA itinerary marker.
    rows = tree.css("table.itineraryDetail tr") or tree.css("table[summary*='itinerary'] tr")
    seen = 0
    for row in rows:
        if seen >= 6:
            break
        try:
            text = row.text(separator="\n").strip()
            if not text:
                continue
            # Look for fare-class miles in the row.
            cabins: dict[str, int] = {}
            for code, cab in [("YS", "Y"), ("WS", "W"), ("CS", "J"), ("FS", "F")]:
                m = re.search(rf"{code}[^0-9]*([0-9][\d,]*)", text)
                if m:
                    cabins[cab] = int(m.group(1).replace(",", ""))

            flight_m = re.search(
                r"\b(?:NH|UA|LH|SQ|TG|OZ|CA|TK|AC|SK|LO|SN|EW|LX|OS)(\d{1,4})\b", text
            )
            if not cabins or not flight_m:
                continue

            cabin_prices = [
                CabinPrice(
                    cabin=cab,  # type: ignore[arg-type]
                    seats_remaining=0,
                    miles_per_pax=miles,
                    surcharge_usd_per_pax=0,
                    taxes_usd_per_pax=0,
                )
                for cab, miles in cabins.items()
            ]

            seg = ResultSegment(
                segment_order=0,
                operating_airline_iata=flight_m.group(0)[:2],
                marketing_airline_iata=flight_m.group(0)[:2],
                flight_number=flight_m.group(1),
                origin_iata=origin,
                dest_iata=dest,
                depart_at=f"{date}T00:00:00Z",
                arrive_at=f"{date}T00:00:00Z",
                aircraft_icao=None,
                segment_cabin=None,
                fare_class=None,
            )

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
                    segments=[seg],
                    cabin_prices=cabin_prices,
                    confidence_score=92,
                    observed_at=now,
                    last_seen_at=now,
                )
            )
            seen += 1
        except Exception as exc:  # noqa: BLE001
            log.debug("ANA row parse error: %s", exc)
            continue
    return results


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",  # noqa: ARG001 — keep signature parity
) -> list[NormalizedResult]:
    """ANA award search — treated as login-gated, no usable anonymous path.

    Returns `[]` immediately and records `verdict="auth_required"` in
    `LAST_RUN_DIAG`. ANA belongs on the T5' user-auth-capture path; see the
    module docstring for the `/diag/wu_probe` evidence and the open question
    (anonymous JSF input form vs member-gated search submit). Never raises.
    """
    global LAST_RUN_DIAG
    LAST_RUN_DIAG = {
        "started_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "origin": origin,
        "dest": dest,
        "date": date,
        "transport": "none — auth_required",
        "verdict": "auth_required",
        "award_search_input_url": AWARD_SEARCH_INPUT_URL,
        "note": (
            "ANA award search is a stateful JSF flow. The input form renders "
            "anonymously via WU (200, 40 KB, mints asw_uuid), but the "
            "partner-award search submit is treated as AMC member-gated "
            "(Agent 5 + flightplan-tool + prior plugin all log in first), "
            "and the JSF ViewState/component IDs needed for a raw search "
            "POST cannot be read via the 800-char-capped wu_probe. Route to "
            "the T5' user-auth-capture flow rather than guessing the JSF POST."
        ),
        "row_count": 0,
    }
    print(
        f"NH: {origin}->{dest} {date} — award search is a member-gated JSF "
        f"flow; returning [] (auth_required, route to T5').",
        flush=True,
    )
    return []


search = _scrape_real
