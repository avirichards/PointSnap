"""FastAPI bridge — Next.js cockpit calls this to run a plugin.

The Next.js `/api/search` route fans out per-program; for `VS_FLYING_CLUB`
it hits this app at `${PYTHON_WORKER_URL}/search?…` instead of the mock
generator. Plugin selection is keyed by the `program` query param.

The bridge's JSON output is intentionally shaped to match the TypeScript
`SearchResultRow` in `src/lib/types.ts`, so the route can forward the
results into the SSE `partial` event without translation.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable, Coroutine

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from common.db import write_results, writeback_skipped
from common.hash import itinerary_hash, operating_flight_key
from common.types import NormalizedResult, SearchQuery

# Per-program plugin modules. Each exports a `search()` coroutine wrapped
# by `with_canonical_fallback` so it always returns SOMETHING (real-scrape
# row when the scrape succeeds; canonical seed otherwise). Real scrape
# implementations land in each module's `_scrape_real()` function across
# Sessions 5-10.
from aa_aadvantage import search as aa_search
from ac_aeroplan import search as ac_search
from af_flyingblue import search as af_search
from as_mileageplan import search as as_search
from av_lifemiles import search as av_search
from ba_avios import search as ba_search
from cx_cathay import search as cx_search
from dl_skymiles import search as dl_search
from lh_miles_more import search as lh_search
from nh_ana import search as nh_search
from tk_miles_smiles import search as tk_search
from ua_mp import search as ua_search
from vs import search as vs_search

load_dotenv()
log = logging.getLogger(__name__)

app = FastAPI(title="pointsnap-workers", version="0.1.0")


PluginCallable = Callable[..., Coroutine[None, None, list[NormalizedResult]]]
PLUGINS: dict[str, PluginCallable] = {
    "VS_FLYING_CLUB": vs_search.search,
    "AS_MILEAGEPLAN": as_search.search,
    "BA_AVIOS": ba_search.search,
    "AV_LIFEMILES": av_search.search,
    "AF_FLYINGBLUE": af_search.search,
    "UA_MP": ua_search.search,
    "TK_MILES_SMILES": tk_search.search,
    "NH_ANA": nh_search.search,
    "AA_AADVANTAGE": aa_search.search,
    "DL_SKYMILES": dl_search.search,
    "CX_CATHAY": cx_search.search,
    "AC_AEROPLAN": ac_search.search,
    "LH_MILES_MORE": lh_search.search,
}


def _serialize(query: SearchQuery, r: NormalizedResult) -> dict:
    """Convert NormalizedResult (snake_case) → SearchResultRow (camelCase).

    The route emits this verbatim into the SSE `partial` event, so any
    drift here breaks the cockpit rendering.
    """
    h = itinerary_hash(r.program_id, query.pax, r.depart_date, r.segments)
    first = r.segments[0]
    op_key = operating_flight_key(
        first.operating_airline_iata, first.flight_number, first.depart_at
    )
    return {
        "id": f"{r.program_id}_{h[:12]}",
        "itineraryHash": h,
        "programId": r.program_id,
        "programName": r.program_name,
        "originIata": r.origin_iata,
        "destIata": r.dest_iata,
        "departDate": r.depart_date,
        "arriveDate": r.arrive_date,
        "totalDurationMin": r.total_duration_min,
        "numSegments": r.num_segments,
        "segments": [
            {
                "segmentOrder": s.segment_order,
                "operatingAirlineIata": s.operating_airline_iata,
                "marketingAirlineIata": s.marketing_airline_iata,
                "flightNumber": s.flight_number,
                "originIata": s.origin_iata,
                "destIata": s.dest_iata,
                "departAt": s.depart_at,
                "arriveAt": s.arrive_at,
                "aircraftIcao": s.aircraft_icao,
                "segmentCabin": s.segment_cabin,
                "fareClass": s.fare_class,
            }
            for s in r.segments
        ],
        "cabinPrices": {
            cp.cabin: {
                "cabin": cp.cabin,
                "seatsRemaining": cp.seats_remaining,
                "milesPerPax": cp.miles_per_pax,
                "surchargeUsdPerPax": cp.surcharge_usd_per_pax,
                "taxesUsdPerPax": cp.taxes_usd_per_pax,
                "cppMicroAtObs": cp.cpp_micro_at_obs,
            }
            for cp in r.cabin_prices
        },
        "confidenceScore": r.confidence_score,
        "observedAt": r.observed_at,
        "lastSeenAt": r.last_seen_at,
        "operatingFlightKey": op_key,
    }


@app.get("/health")
async def health() -> dict[str, str | bool]:
    return {"status": "ok", "dbSkipped": writeback_skipped()}


@app.get("/diag/proxy")
async def diag_proxy() -> JSONResponse:
    """Smoke-test Patchright + IPRoyal proxy. Loads httpbin.org/ip via
    the configured proxy and returns the egress IP. If the IP is
    IPRoyal's exit pool, proxy is working. If it's Fly's egress, proxy
    config is silently being ignored. If it errors with ERR_TUNNEL_
    CONNECTION_FAILED, the Chromium-auth bug is still present."""
    import os
    try:
        from common.browser import browser_page
        no_proxy = os.environ.get("SCRAPER_NO_PROXY") == "1"
        async with browser_page(timeout_ms=20_000) as page:
            await page.goto("https://httpbin.org/ip", wait_until="domcontentloaded")
            body_text = await page.locator("body").inner_text()
            return JSONResponse({
                "ok": True,
                "no_proxy_flag": no_proxy,
                "body": body_text,
            })
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            {"ok": False, "error": str(exc)[:500]},
            status_code=500,
        )


@app.get("/diag/inputs")
async def diag_inputs(
    url: str = Query(..., description="URL to load via Patchright"),
    use_proxy: int = Query(1, description="0 = bypass proxy"),
) -> JSONResponse:
    """Loads a page and dumps all input/button selectors. Use to find the
    right `name=` / `id=` for the form fields each scraper has to fill."""
    try:
        from common.browser import browser_page
        async with browser_page(timeout_ms=30_000, use_proxy=bool(use_proxy)) as page:
            resp = await page.goto(url, wait_until="domcontentloaded")
            inputs = await page.evaluate(
                """() => Array.from(document.querySelectorAll('input,button,select')).map(el => ({
                    tag: el.tagName.toLowerCase(),
                    type: el.type || null,
                    name: el.getAttribute('name') || null,
                    id: el.id || null,
                    placeholder: el.placeholder || null,
                    aria_label: el.getAttribute('aria-label') || null,
                    text: (el.innerText || el.value || '').slice(0, 50),
                })).filter(x => x.name || x.id || x.placeholder || x.aria_label)"""
            )
            return JSONResponse({
                "ok": True,
                "url": page.url,
                "status": resp.status if resp else None,
                "title": await page.title(),
                "inputs": inputs[:50],  # cap
            })
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(exc)[:500]}, status_code=500)


@app.get("/diag/airline")
async def diag_airline(
    url: str = Query(..., description="Full URL to load via Patchright"),
    use_proxy: int = Query(1, description="0 = bypass proxy (use Fly egress)"),
    wait_ms: int = Query(0, description="ms to wait after domcontentloaded"),
    wait_until: str = Query("domcontentloaded", description="domcontentloaded|load|commit|networkidle"),
    country: str = Query("us", description="IPRoyal exit country (us, gb, ca, jp, etc.)"),
    session: str = Query("", description="IPRoyal sticky session id (optional)"),
    http2: int = Query(0, description="1 = enable HTTP/2 (default disabled)"),
) -> JSONResponse:
    """Smoke-test Patchright reaching a specific airline URL. Returns
    page title + status + any console errors + a snippet of body html."""
    try:
        from common.browser import browser_page
        console_errors: list[str] = []
        async with browser_page(
            timeout_ms=45_000,
            use_proxy=bool(use_proxy),
            proxy_country=country or None,
            proxy_session=session or None,
            disable_http2=not bool(http2),
        ) as page:
            page.on(
                "console",
                lambda msg: console_errors.append(f"{msg.type}: {msg.text}")
                if msg.type in ("error", "warning") else None,
            )
            resp = await page.goto(url, wait_until=wait_until)  # type: ignore[arg-type]
            if wait_ms:
                await asyncio.sleep(wait_ms / 1000)
            title = await page.title()
            body_text = (await page.locator("body").inner_text())[:600] if resp else ""
            return JSONResponse({
                "ok": True,
                "status": resp.status if resp else None,
                "title": title,
                "url": page.url,
                "body_snippet": body_text,
                "console_errors": console_errors[-10:],
            })
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            {"ok": False, "error": str(exc)[:500]},
            status_code=500,
        )


@app.get("/diag/ac_scrape")
async def diag_ac_scrape(
    origin: str = Query("YYZ"),
    dest: str = Query("LHR"),
    date: str = Query("2026-08-15"),
) -> JSONResponse:
    """Run the AC flow inline with per-step diagnostics so we can see
    whether the XHR fires, the page state, and where 0 rows come from."""
    try:
        from common.browser import browser_page
        from ac_aeroplan.search import (
            SEARCH_URL_TMPL,
            WARMUP_URL,
            AIR_BOUNDS_PATH,
            _parse_air_bounds,
        )

        url = SEARCH_URL_TMPL.format(origin=origin, dest=dest, date=date)
        captured: dict = {"responses_seen": [], "page_title": None, "page_url": None}

        async with browser_page(
            timeout_ms=60_000, use_proxy=False, disable_http2=False
        ) as page:
            async def on_response(resp):
                try:
                    if AIR_BOUNDS_PATH in resp.url:
                        captured["responses_seen"].append(
                            {"url": resp.url, "status": resp.status}
                        )
                        if resp.status == 200:
                            captured["json"] = await resp.json()
                except Exception as exc:  # noqa: BLE001
                    captured["responses_seen"].append({"error": str(exc)[:200]})
            page.on("response", on_response)

            # Warmup: load homepage so Akamai sensor.js mints solved cookies.
            try:
                wresp = await page.goto(WARMUP_URL, wait_until="domcontentloaded", timeout=30_000)
                captured["warmup_status"] = wresp.status if wresp else None
                await asyncio.sleep(4.0)
            except Exception as exc:  # noqa: BLE001
                captured["warmup_error"] = str(exc)[:200]

            resp = await page.goto(url, wait_until="domcontentloaded")
            captured["initial_status"] = resp.status if resp else None
            for _ in range(30):
                if captured.get("json"):
                    break
                await asyncio.sleep(1.0)
            captured["page_title"] = await page.title()
            captured["page_url"] = page.url
            captured["body_snippet"] = (await page.locator("body").inner_text())[:400]

        payload = captured.get("json")
        if not payload:
            return JSONResponse({"ok": False, "stage": "no_xhr_captured", **{k: v for k, v in captured.items() if k != "json"}})
        rows = _parse_air_bounds(payload, origin, dest, date)
        groups = (payload.get("data") or {}).get("airBoundGroups") or []
        return JSONResponse({
            "ok": True,
            "groups_in_payload": len(groups),
            "rows_parsed": len(rows),
            "first_group_keys": list((groups[0] or {}).keys()) if groups else [],
            "responses_seen": captured["responses_seen"][:5],
            "page_title": captured["page_title"],
            "page_url": captured["page_url"],
        })
    except Exception as exc:  # noqa: BLE001
        import traceback
        return JSONResponse(
            {"ok": False, "error": str(exc)[:500], "traceback": traceback.format_exc()[-1000:]},
            status_code=500,
        )


@app.get("/diag/ua_scrape")
async def diag_ua_scrape(
    origin: str = Query("EWR"),
    dest: str = Query("HKG"),
    date: str = Query("2026-08-15"),
) -> JSONResponse:
    """Run the UA flow inline with per-step diagnostics."""
    try:
        import json as _json
        from common.browser import browser_page
        from ua_mp.search import SEARCH_PAGE, _build_body, _united_cabin

        async with browser_page(timeout_ms=60_000) as page:
            r = await page.goto(SEARCH_PAGE, wait_until="domcontentloaded")
            await asyncio.sleep(3.0)
            initial_status = r.status if r else None
            page_title = await page.title()
            page_url = page.url

            token_result = await page.evaluate(
                """async () => {
                    try {
                        const r = await fetch('/api/token/anonymous', {credentials: 'include'});
                        const txt = await r.text();
                        return {status: r.status, body: txt.slice(0, 500)};
                    } catch(e) { return {error: String(e)}; }
                }"""
            )
            # Extract token if successful
            token = None
            try:
                if token_result.get("status") == 200:
                    parsed = _json.loads(token_result.get("body") or "{}")
                    token = parsed.get("data", {}).get("token", {}).get("hash")
            except Exception:  # noqa: BLE001
                pass

            search_result = None
            if token:
                body = _build_body(origin, dest, date, 1, _united_cabin("Y"))
                search_result = await page.evaluate(
                    """async ({body, token}) => {
                        try {
                            const r = await fetch('/api/flight/FetchFlights', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Accept': '*/*',
                                    'x-authorization-api': 'bearer ' + token,
                                },
                                body: JSON.stringify(body),
                                credentials: 'include',
                            });
                            const t = await r.text();
                            return { status: r.status, body_head: t.slice(0, 400) };
                        } catch(e) { return {error: String(e)}; }
                    }""",
                    {"body": body, "token": token},
                )

        return JSONResponse({
            "ok": True,
            "page_initial_status": initial_status,
            "page_title": page_title,
            "page_url": page_url,
            "token_result": token_result,
            "token_extracted": bool(token),
            "search_result": search_result,
        })
    except Exception as exc:  # noqa: BLE001
        import traceback
        return JSONResponse(
            {"ok": False, "error": str(exc)[:500], "traceback": traceback.format_exc()[-1000:]},
            status_code=500,
        )


@app.get("/search")
async def search(
    program: str = Query(..., description="Program ID, e.g. VS_FLYING_CLUB"),
    origin: str = Query(..., min_length=3, max_length=3),
    dest: str = Query(..., min_length=3, max_length=3),
    date: str = Query(..., description="Depart date YYYY-MM-DD"),
    pax: int = Query(1, ge=1, le=9),
    minCabin: str = Query("Y", pattern="^[YWJF]$"),
) -> JSONResponse:
    plugin = PLUGINS.get(program)
    if plugin is None:
        raise HTTPException(status_code=404, detail=f"Unknown program: {program}")

    origin_u = origin.upper()
    dest_u = dest.upper()
    query = SearchQuery(
        origin=origin_u, dest=dest_u, depart_date=date, pax=pax, min_cabin=minCabin  # type: ignore[arg-type]
    )

    try:
        results = await plugin(origin_u, dest_u, date, minCabin)
    except Exception as exc:  # noqa: BLE001 — surface scraper errors to caller
        log.exception("Plugin %s raised", program)
        raise HTTPException(status_code=502, detail=f"Plugin error: {exc}") from exc

    db_summary = await write_results(query, results)
    rows = [_serialize(query, r) for r in results]
    return JSONResponse(
        {
            "program": program,
            "origin": origin_u,
            "dest": dest_u,
            "date": date,
            "rows": rows,
            "db": db_summary,
        }
    )
