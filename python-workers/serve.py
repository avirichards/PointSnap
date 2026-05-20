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
from aa_aadvantage import search_wu as aa_search_wu
from ac_aeroplan import search as ac_search
from af_flyingblue import search as af_search
from as_mileageplan import search as as_search
from av_lifemiles import search as av_search
from b6_jetblue import search as b6_search
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

# Phase 2.5 user-initiated auth-capture routes (T5' tier).
# /auth/start, /auth/status, /auth/finalize — see auth/capture.py.
from auth.capture import router as auth_router
app.include_router(auth_router, prefix="/auth")


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
    "AA_AADVANTAGE_WU": aa_search_wu.search,
    "DL_SKYMILES": dl_search.search,
    "CX_CATHAY": cx_search.search,
    "AC_AEROPLAN": ac_search.search,
    "LH_MILES_MORE": lh_search.search,
    "B6_TRUEBLUE": b6_search.search,
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


@app.get("/diag/wu_probe")
async def diag_wu_probe(
    url: str = Query(..., description="Target URL to fetch via BD Web Unlocker"),
    method: str = Query("GET", description="GET or POST"),
) -> JSONResponse:
    """Probe BD Web Unlocker with format=json to inspect the response
    envelope — status, header keys, Set-Cookie, body head. Used to design
    the AA two-step flow (homepage GET to mint a session → API POST)."""
    try:
        from common.bd_wu import wu_request_json
        status, envelope = await wu_request_json(url, method=method)
        summary: dict = {"wu_http_status": status}
        if isinstance(envelope, dict):
            summary["envelope_keys"] = list(envelope.keys())
            summary["target_status"] = (
                envelope.get("status_code") or envelope.get("status")
                or envelope.get("status_code".upper())
            )
            hdrs = envelope.get("headers") or envelope.get("response_headers") or {}
            if isinstance(hdrs, dict):
                summary["target_header_keys"] = sorted(hdrs.keys())
                # Set-Cookie is the prize — try several casings/shapes
                summary["set_cookie"] = (
                    hdrs.get("set-cookie") or hdrs.get("Set-Cookie")
                )
                # BD's own error signalling — tells us WHY a fetch failed
                summary["x_brd_error"] = (
                    hdrs.get("x-brd-error") or hdrs.get("X-Brd-Error")
                )
                summary["x_brd_error_code"] = (
                    hdrs.get("x-brd-error-code") or hdrs.get("X-Brd-Error-Code")
                )
            body = envelope.get("body")
            if isinstance(body, str):
                summary["body_len"] = len(body)
                summary["body_head"] = body[:800]
                # Look for AA session cookie names embedded in the body
                for marker in ("XSRF-TOKEN", "spa_session_id", "_abck", "ak_bmsc"):
                    summary[f"body_has_{marker}"] = marker in body
        else:
            summary["envelope"] = "non-JSON response (see WU error)"
        return JSONResponse(summary)
    except Exception as exc:  # noqa: BLE001
        import traceback
        return JSONResponse(
            {"ok": False, "error": str(exc)[:400], "tb": traceback.format_exc()[-600:]},
            status_code=500,
        )


@app.get("/health")
async def health() -> dict[str, str | bool]:
    return {"status": "ok", "dbSkipped": writeback_skipped()}


@app.get("/programs/meta")
async def programs_meta() -> JSONResponse:
    """Per-program metadata for the cockpit: max booking window in days,
    plus the registered program list. Cockpit calendar reads this to
    disable out-of-window dates per program."""
    from common.program_windows import PROGRAM_MAX_DAYS_OUT, DEFAULT_MAX_DAYS_OUT
    return JSONResponse({
        "programs": [
            {"programId": pid, "maxDaysOut": PROGRAM_MAX_DAYS_OUT.get(pid, DEFAULT_MAX_DAYS_OUT)}
            for pid in PLUGINS.keys()
        ],
        "defaultMaxDaysOut": DEFAULT_MAX_DAYS_OUT,
    })


@app.get("/diag/aa_last")
async def diag_aa_last() -> JSONResponse:
    """Return the last AA scrape's captured XHRs + diagnostic info.
    Workaround for not having fly-logs access right now."""
    try:
        from aa_aadvantage.search import LAST_RUN_DIAG
        return JSONResponse(LAST_RUN_DIAG)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.get("/diag/aa_wu_last")
async def diag_aa_wu_last() -> JSONResponse:
    """Last AA Web Unlocker variant run — captures WU status, raw_text head,
    parsed JSON keys, AA error envelope, slice count."""
    try:
        from aa_aadvantage.search_wu import LAST_RUN_DIAG as WU_DIAG
        return JSONResponse(WU_DIAG)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=500)


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
    url: str = Query(..., description="Full URL to load via Patchright/Camoufox"),
    use_proxy: int = Query(1, description="0 = bypass proxy (use Fly egress)"),
    wait_ms: int = Query(0, description="ms to wait after domcontentloaded"),
    wait_until: str = Query("domcontentloaded", description="domcontentloaded|load|commit|networkidle"),
    country: str = Query("us", description="IPRoyal exit country (us, gb, ca, jp, etc.)"),
    session: str = Query("", description="IPRoyal sticky session id (optional)"),
    http2: int = Query(0, description="1 = enable HTTP/2 (default disabled)"),
    scraperapi: int = Query(0, description="1 = route through ScraperAPI proxy port"),
    scraperapi_render: int = Query(1, description="0 = no render (saves credits)"),
    brightdata: int = Query(0, description="1 = route through Bright Data Browser API (CDP); takes precedence over scraperapi/use_proxy"),
    use_camoufox: int = Query(0, description="1 = use Camoufox (Firefox stealth) instead of Patchright"),
    brightdata_residential: int = Query(0, description="1 = use BD Residential proxy (requires use_camoufox=1; sets BD as the egress)"),
    brightdata_country: str = Query("", description="BD Residential country code (us, gb, de, jp, etc.) — used when brightdata_residential=1"),
    brightdata_session: str = Query("", description="BD sticky session id (~10min IP pinning); used by both brightdata=1 and brightdata_residential=1"),
    referer: str = Query("", description="optional Referer header for the navigation"),
    user_agent: str = Query("", description="optional User-Agent override (e.g., mobile UA for sites that route mobile traffic differently)"),
) -> JSONResponse:
    """Smoke-test reaching a specific airline URL. Returns page title +
    status + any console errors + a snippet of body html.

    Transport selection:
      brightdata_residential=1 + use_camoufox=1  → T3 (canonical Akamai bypass)
      use_camoufox=1                              → Camoufox + Fly egress
      brightdata=1                                → BD Browser API (legacy CDP path)
      scraperapi=1                                → ScraperAPI (deprecated)
      default                                     → Patchright + IPRoyal
    """
    try:
        from common.browser import browser_page
        console_errors: list[str] = []
        # Higher timeout for stealth browsers (Camoufox first-startup + BD
        # residential CONNECT can each take 30+s).
        timeout_ms = 120_000 if (scraperapi or brightdata or use_camoufox or brightdata_residential) else 45_000
        async with browser_page(
            timeout_ms=timeout_ms,
            use_proxy=bool(use_proxy) and not (brightdata or brightdata_residential),
            proxy_country=country or None,
            proxy_session=session or None,
            disable_http2=not bool(http2),
            use_scraperapi=bool(scraperapi) and not (brightdata or brightdata_residential),
            scraperapi_render=bool(scraperapi_render),
            use_brightdata=bool(brightdata) and not brightdata_residential,
            use_camoufox=bool(use_camoufox),
            use_brightdata_residential=bool(brightdata_residential),
            brightdata_country=brightdata_country or None,
            brightdata_session=brightdata_session or None,
        ) as page:
            if user_agent:
                # Override UA at the context level so subsequent requests
                # inherit it. Useful for probing AA mobile-vs-desktop routing.
                await page.set_extra_http_headers({"User-Agent": user_agent})
            page.on(
                "console",
                lambda msg: console_errors.append(f"{msg.type}: {msg.text}")
                if msg.type in ("error", "warning") else None,
            )
            goto_kwargs: dict = {"wait_until": wait_until}
            if referer:
                goto_kwargs["referer"] = referer
            resp = await page.goto(url, **goto_kwargs)  # type: ignore[arg-type]
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


@app.get("/diag/warmup")
async def diag_warmup(
    warmup_url: str = Query(..., description="First URL to load (mints Akamai cookies via sensor.js)"),
    target_url: str = Query(..., description="Second URL — loaded in the same browser session after warmup"),
    warmup_wait_ms: int = Query(5000, description="ms to wait after warmup page loads (sensor.js completion)"),
    target_wait_ms: int = Query(2000, description="ms to wait after target page loads"),
    brightdata: int = Query(1, description="route via Bright Data (default 1 for this endpoint)"),
    capture_xhr: str = Query("", description="optional substring; capture first matching XHR response body"),
) -> JSONResponse:
    """Two-step navigation: load warmup_url first to mint Akamai/Imperva
    cookies in the BD browser session, then load target_url in the same
    session. Returns both responses' status + title + cookies count. Use
    this to bypass Akamai path-protection on sites like aa.com where the
    homepage 403s but specific paths (loyalty, aadvantage) succeed."""
    try:
        from common.browser import browser_page
        result: dict = {"warmup": {}, "target": {}, "captured": None}
        captured_body: dict = {}
        async with browser_page(
            timeout_ms=120_000,
            use_brightdata=bool(brightdata),
        ) as page:
            if capture_xhr:
                async def _on_response(resp):
                    if capture_xhr in resp.url and resp.status == 200 and "captured" not in captured_body:
                        try:
                            captured_body["captured"] = {
                                "url": resp.url,
                                "status": resp.status,
                                "body": (await resp.text())[:2000],
                            }
                        except Exception:  # noqa: BLE001
                            pass
                page.on("response", _on_response)

            # Step 1: warmup
            try:
                r1 = await page.goto(warmup_url, wait_until="domcontentloaded", timeout=60_000)
                await asyncio.sleep(warmup_wait_ms / 1000)
                result["warmup"] = {
                    "status": r1.status if r1 else None,
                    "title": (await page.title())[:80],
                    "url": page.url,
                    "cookies": len(await page.context.cookies()),
                }
            except Exception as exc:  # noqa: BLE001
                result["warmup"] = {"error": str(exc)[:200]}
                return JSONResponse({"ok": False, **result})

            # Step 2: target (same session, cookies carry over)
            try:
                r2 = await page.goto(target_url, wait_until="domcontentloaded", timeout=60_000, referer=warmup_url)
                await asyncio.sleep(target_wait_ms / 1000)
                body = (await page.locator("body").inner_text())[:400]
                result["target"] = {
                    "status": r2.status if r2 else None,
                    "title": (await page.title())[:80],
                    "url": page.url,
                    "cookies": len(await page.context.cookies()),
                    "body_snippet": body,
                }
            except Exception as exc:  # noqa: BLE001
                result["target"] = {"error": str(exc)[:200]}

            if captured_body:
                result["captured"] = captured_body.get("captured")

            target_status = result["target"].get("status")
            target_body = result["target"].get("body_snippet", "")
            ok = (target_status == 200 and "Access Denied" not in target_body)
            return JSONResponse({"ok": ok, **result})
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

            resp = await page.goto(url, wait_until="domcontentloaded", referer=WARMUP_URL)
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


@app.get("/diag/run_plugin")
async def diag_run_plugin(
    program: str = Query(...),
    origin: str = Query(..., min_length=3, max_length=3),
    dest: str = Query(..., min_length=3, max_length=3),
    date: str = Query(...),
) -> JSONResponse:
    """Run a plugin in isolation with traceback capture. Surfaces the
    actual exception for plugins that 500 in production /search.

    Calls plugin → captures any raise. Calls _serialize → captures separately.
    Skips write_results (DB write). This lets us see if the failure is in
    the scrape or in serialization."""
    import traceback
    plugin = PLUGINS.get(program)
    if plugin is None:
        return JSONResponse({"ok": False, "error": f"Unknown program: {program}"}, status_code=404)

    origin_u = origin.upper()
    dest_u = dest.upper()

    plugin_err: dict | None = None
    rows: list[NormalizedResult] = []
    try:
        rows = await plugin(origin_u, dest_u, date, "Y")
    except Exception as exc:  # noqa: BLE001
        plugin_err = {
            "type": type(exc).__name__,
            "msg": str(exc)[:500],
            "traceback": traceback.format_exc()[-2000:],
        }

    if plugin_err:
        return JSONResponse({"ok": False, "stage": "plugin", **plugin_err})

    # Try to serialize each row individually so we can see which one breaks
    query = SearchQuery(origin=origin_u, dest=dest_u, depart_date=date, pax=1, min_cabin="Y")  # type: ignore[arg-type]
    serialized: list[dict] = []
    serialize_err: dict | None = None
    for i, r in enumerate(rows):
        try:
            serialized.append(_serialize(query, r))
        except Exception as exc:  # noqa: BLE001
            serialize_err = {
                "row_index": i,
                "type": type(exc).__name__,
                "msg": str(exc)[:500],
                "traceback": traceback.format_exc()[-2000:],
                "row_repr": repr(r)[:1000],
            }
            break

    return JSONResponse({
        "ok": serialize_err is None,
        "row_count": len(rows),
        "serialized_count": len(serialized),
        "serialize_err": serialize_err,
        "sample": serialized[:1],
    })


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

    try:
        db_summary = await write_results(query, results)
    except Exception as exc:  # noqa: BLE001 — surface DB errors with detail
        log.exception("write_results failed for %s", program)
        import traceback
        raise HTTPException(
            status_code=503,
            detail=f"DB write error ({type(exc).__name__}): {str(exc)[:500]} | tb: {traceback.format_exc()[-500:]}",
        ) from exc

    try:
        rows = [_serialize(query, r) for r in results]
    except Exception as exc:  # noqa: BLE001
        log.exception("_serialize failed for %s", program)
        import traceback
        raise HTTPException(
            status_code=503,
            detail=f"Serialize error ({type(exc).__name__}): {str(exc)[:500]} | tb: {traceback.format_exc()[-500:]}",
        ) from exc
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
