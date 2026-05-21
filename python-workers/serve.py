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


@app.get("/diag/dl_last")
async def diag_dl_last() -> JSONResponse:
    """Last DL SkyMiles run (WU 2-step transport) — captures the homepage
    cookie-mint diag, the `/shop/ow/search` POST status, raw_text head,
    parsed JSON keys, Delta's shoppingError envelope, and itinerary count."""
    try:
        from dl_skymiles.search import LAST_RUN_DIAG as DL_DIAG
        return JSONResponse(DL_DIAG)
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


@app.get("/diag/dbcheck")
async def diag_dbcheck(
    user_id: str = Query("", description="UUID to check in auth.users"),
) -> JSONResponse:
    """Verify the program_auth_sessions save path — diagnoses a
    db_save_failed from the auth-capture flow. Read-only: checks whether
    the password_secret_id column + encrypt_password/encrypt_cookies
    functions exist, whether `user_id` is a real auth.users row, and
    which migrations have been applied."""
    import os
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return JSONResponse(
            {"ok": False, "error": "DATABASE_URL unset"}, status_code=500
        )
    out: dict = {}
    try:
        import psycopg
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT EXISTS(SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema='public' "
                    "AND table_name='program_auth_sessions' "
                    "AND column_name='password_secret_id')"
                )
                out["password_secret_id_column"] = (await cur.fetchone())[0]
                await cur.execute(
                    "SELECT EXISTS(SELECT 1 FROM pg_proc "
                    "WHERE proname='encrypt_password')"
                )
                out["encrypt_password_fn"] = (await cur.fetchone())[0]
                await cur.execute(
                    "SELECT EXISTS(SELECT 1 FROM pg_proc "
                    "WHERE proname='encrypt_cookies')"
                )
                out["encrypt_cookies_fn"] = (await cur.fetchone())[0]
                if user_id:
                    try:
                        await cur.execute(
                            "SELECT EXISTS(SELECT 1 FROM auth.users "
                            "WHERE id=%s::uuid)",
                            (user_id,),
                        )
                        out["user_in_auth_users"] = (await cur.fetchone())[0]
                    except Exception as e:  # noqa: BLE001
                        out["user_in_auth_users"] = f"query-failed: {e}"
                try:
                    await cur.execute(
                        "SELECT version FROM "
                        "supabase_migrations.schema_migrations ORDER BY version"
                    )
                    out["applied_migrations"] = [
                        r[0] for r in await cur.fetchall()
                    ]
                except Exception as e:  # noqa: BLE001
                    out["applied_migrations"] = f"query-failed: {e}"
        return JSONResponse({"ok": True, **out})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            {"ok": False, "error": str(exc)[:500], "partial": out},
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


@app.get("/diag/sysinfo")
async def diag_sysinfo() -> JSONResponse:
    """Report the worker VM's memory + /dev/shm size + process list.

    Used to diagnose the Camoufox `WriteUnixTransport closed` crash —
    Firefox dying mid-render on a container is almost always OOM or a
    too-small /dev/shm.
    """
    import shutil
    import subprocess
    out: dict = {}
    try:
        with open("/proc/meminfo") as f:
            mem = {}
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    mem[parts[0].strip()] = parts[1].strip()
        out["meminfo"] = {
            k: mem.get(k)
            for k in ("MemTotal", "MemFree", "MemAvailable", "SwapTotal", "SwapFree")
        }
    except Exception as exc:  # noqa: BLE001
        out["meminfo_error"] = str(exc)
    try:
        total, used, free = shutil.disk_usage("/dev/shm")
        out["dev_shm"] = {
            "total_mb": round(total / 1048576, 1),
            "used_mb": round(used / 1048576, 1),
            "free_mb": round(free / 1048576, 1),
        }
    except Exception as exc:  # noqa: BLE001
        out["dev_shm_error"] = str(exc)
    try:
        out["tmp_dir"] = shutil.disk_usage("/tmp")._asdict()
    except Exception:  # noqa: BLE001
        pass
    try:
        ps = subprocess.run(
            ["ps", "-eo", "pid,rss,comm", "--sort=-rss"],
            capture_output=True, text=True, timeout=10,
        )
        out["top_processes"] = ps.stdout.splitlines()[:15]
    except Exception as exc:  # noqa: BLE001
        out["ps_error"] = str(exc)
    return JSONResponse(out)


def _firefox_crash_artifacts() -> list[dict]:
    """Glob for Firefox crash-report `.extra` files left by a crashed
    Camoufox/Playwright Firefox process. The `.extra` file is plaintext
    key=value with the crash signature (`MozCrashReason`, `Signature`,
    `GraphicsCriticalError`, ...) — exactly what we need to know WHY
    Firefox died. Playwright launches Firefox with a temp profile under
    /tmp; crash dumps land in `<profile>/minidumps` or a `Crash Reports`
    dir under the cache.
    """
    import glob as _glob
    found: list[dict] = []
    roots = [
        "/tmp", "/root/.mozilla", "/root/.cache",
        os.path.expanduser("~/.mozilla"),
    ]
    seen: set[str] = set()
    for root in roots:
        for pat in ("**/*.extra", "**/minidumps/*.extra",
                    "**/Crash Reports/**/*.extra"):
            try:
                for fp in _glob.glob(os.path.join(root, pat), recursive=True):
                    if fp in seen:
                        continue
                    seen.add(fp)
                    try:
                        with open(fp, errors="replace") as f:
                            txt = f.read()
                        found.append({"file": fp, "content": txt[:4000]})
                    except Exception as exc:  # noqa: BLE001
                        found.append({"file": fp, "read_error": str(exc)[:200]})
            except Exception:  # noqa: BLE001
                pass
    return found[:8]


@app.get("/diag/ac_air_bounds")
async def diag_ac_air_bounds(
    user_id: str = Query(..., description="User UUID with a captured AC_AEROPLAN session"),
    origin: str = Query("YYZ"),
    dest: str = Query("YVR"),
    date: str = Query("2026-07-15"),
    wait_s: int = Query(45, description="seconds to wait for the air-bounds XHR"),
    headless: str = Query("true", description="Camoufox headless mode: 'true' (offscreen) | 'virtual' (Xvfb)"),
    webgl_off: int = Query(0, description="1 = disable WebGL via firefox prefs (crash-isolation test)"),
    fast_nav: int = Query(0, description="1 = skip the post-load sleep, drive in-app nav immediately"),
) -> JSONResponse:
    """Capture Air Canada's real logged-in air-bounds request.

    Opens a **Camoufox** browser (Fly direct egress — NO proxy; IPRoyal
    blocks aircanada.com at CONNECT), injects the user's captured Aeroplan
    cookie jar via `context.add_cookies` (works on Firefox/Camoufox — the
    BD Browser API "Overriding X forbidden" wall does NOT apply), navigates
    the redeem SPA, drives an in-app route change to the availability page,
    and records every network request whose URL contains `air-bounds`.

    The Camoufox lifecycle is managed DIRECTLY here (not via
    `browser_page`) so that (a) a `Browser.close ... handler is closed`
    teardown crash — which fires when Firefox's process has already died —
    does NOT discard the data captured so far, and (b) every phase appends
    to a `steps` trace, so a crash mid-flow shows exactly where it died.
    On a crash, Firefox's crash-report `.extra` files are globbed + returned
    so we can read the actual crash signature.
    """
    import time as _time
    import traceback
    # Make Firefox write a crash report locally (plaintext .extra) instead
    # of phoning home / silently dying — so _firefox_crash_artifacts() can
    # read the crash signature.
    os.environ.setdefault("MOZ_CRASHREPORTER", "1")
    os.environ.setdefault("MOZ_CRASHREPORTER_NO_REPORT", "1")
    os.environ.setdefault("MOZ_CRASHREPORTER_SHUTDOWN", "1")
    out: dict = {
        "user_id": user_id,
        "origin": origin,
        "dest": dest,
        "date": date,
        "transport": "camoufox_fly_egress",
    }
    steps: list[dict] = []
    t0 = _time.time()

    def _step(name: str, **extra) -> None:
        steps.append({"t": round(_time.time() - t0, 1), "step": name, **extra})

    air_bounds_reqs: list[dict] = []
    air_bounds_resps: list[dict] = []
    all_loyalty_urls: list[str] = []
    browser = None
    try:
        from camoufox.async_api import AsyncCamoufox

        from common.auth_session import get_active_session
        from ac_aeroplan.search import SEARCH_PAGE_TMPL, build_camoufox_config

        _step("started")
        session = await get_active_session(user_id, "AC_AEROPLAN")
        out["session_found"] = bool(session)
        if not session:
            return JSONResponse({"ok": False, "stage": "no_session", **out, "steps": steps})

        cookies = session.get("cookies") or []
        out["cookie_count"] = len(cookies)
        out["session_expires_at"] = session.get("expires_at")
        REDEEM_ROOT = "https://www.aircanada.com/aeroplan/redeem/"
        search_url = SEARCH_PAGE_TMPL.format(origin=origin, dest=dest, date=date)
        out["search_url"] = search_url

        # ---- launch Camoufox (direct lifecycle; crash-safe teardown) ----
        hl: Any = "virtual" if headless.lower() == "virtual" else True
        out["headless_mode"] = hl
        cf_config = build_camoufox_config(headless=hl)
        if webgl_off:
            # Crash-isolation: hard-disable WebGL. If the Firefox process
            # then survives the AC redeem SPA, a software-WebGL draw was
            # the crasher.
            cf_config["firefox_user_prefs"].update({
                "webgl.disabled": True,
                "webgl.force-enabled": False,
                "dom.webgpu.enabled": False,
                "gfx.canvas.accelerated": False,
                "layers.acceleration.disabled": True,
            })
            out["webgl_off"] = True
        _step("camoufox_launch_begin", headless=str(hl), webgl_off=bool(webgl_off))
        browser = await AsyncCamoufox(**cf_config).__aenter__()
        _step("camoufox_launched")
        ctx = await browser.new_context()
        page = await ctx.new_page()
        page.set_default_timeout(120_000)

        # Block only heavy media — keep CSS/JS so the SPA + Kasada p.js run.
        async def _block_heavy(route):
            if route.request.resource_type in ("image", "media"):
                await route.abort()
            else:
                await route.continue_()
        await page.route("**/*", _block_heavy)

        def _on_request(req):
            try:
                u = req.url
                if "/loyalty/" in u or "dapidynamic" in u:
                    all_loyalty_urls.append(f"{req.method} {u}")
                if "air-bounds" in u:
                    post_data = None
                    try:
                        post_data = req.post_data
                    except Exception:  # noqa: BLE001
                        pass
                    air_bounds_reqs.append({
                        "url": u,
                        "method": req.method,
                        "headers": dict(req.headers),
                        "post_data": post_data,
                    })
            except Exception:  # noqa: BLE001
                pass

        async def _on_response(resp):
            try:
                if "air-bounds" in resp.url:
                    body_head = ""
                    try:
                        body_head = (await resp.text())[:6000]
                    except Exception:  # noqa: BLE001
                        pass
                    air_bounds_resps.append({
                        "url": resp.url,
                        "status": resp.status,
                        "body_head": body_head,
                    })
            except Exception:  # noqa: BLE001
                pass

        page.on("request", _on_request)
        page.on("response", _on_response)

        # ---- inject the captured Aeroplan session ----
        store_diag: dict = {"set_ok": 0, "set_fail": 0}
        pw_cookies: list[dict] = []
        for c in cookies:
            if not c.get("name") or "value" not in c or not c.get("domain"):
                continue
            nc: dict = {
                "name": c["name"],
                "value": str(c["value"]),
                "domain": c["domain"],
                "path": c.get("path") or "/",
                "secure": bool(c.get("secure", True)),
                "httpOnly": bool(c.get("httpOnly", False)),
            }
            ss = c.get("sameSite")
            if ss in ("Strict", "Lax", "None"):
                nc["sameSite"] = ss
            exp = c.get("expires")
            if exp is not None and exp != -1:
                try:
                    nc["expires"] = int(exp)
                except (TypeError, ValueError):
                    pass
            pw_cookies.append(nc)
        try:
            await ctx.add_cookies(pw_cookies)
            store_diag["set_ok"] = len(pw_cookies)
            store_diag["mode"] = "batch"
        except Exception as exc:  # noqa: BLE001
            store_diag["batch_error"] = str(exc)[:200]
            for nc in pw_cookies:
                try:
                    await ctx.add_cookies([nc])
                    store_diag["set_ok"] += 1
                except Exception as exc2:  # noqa: BLE001
                    store_diag["set_fail"] += 1
                    if "first_err" not in store_diag:
                        store_diag["first_err"] = f"{nc['name']}: {str(exc2)[:140]}"
            store_diag["mode"] = "one_by_one"
        out["store_inject"] = dict(store_diag)
        _step("cookies_injected", set_ok=store_diag["set_ok"])
        try:
            out["jar_after_inject"] = len(await ctx.cookies())
        except Exception:  # noqa: BLE001
            pass

        nav_attempts: list[dict] = []

        async def _nav(url: str, label: str, attempts: int = 3) -> bool:
            for attempt in range(attempts):
                try:
                    r = await page.goto(url, wait_until="domcontentloaded", timeout=90_000)
                    await asyncio.sleep(5.0)
                    title = ""
                    try:
                        title = await page.title()
                    except Exception:  # noqa: BLE001
                        pass
                    nav_attempts.append({
                        "step": label, "attempt": attempt,
                        "status": r.status if r else None,
                        "url": page.url, "title": title,
                    })
                    if "Access Denied" not in title and not (r and r.status == 403):
                        return True
                    await asyncio.sleep(2.0)
                except Exception as exc:  # noqa: BLE001
                    nav_attempts.append({
                        "step": label, "attempt": attempt,
                        "error": str(exc)[:200],
                    })
                    await asyncio.sleep(2.0)
            return False

        # Step 1: redeem SPA root (the /availability/ deep-link is Akamai
        # path-protected; the SPA root is not).
        _step("nav_redeem_root_begin")
        landed = await _nav(REDEEM_ROOT, "redeem_root")
        _step("nav_redeem_root_done", landed=landed)

        if landed:
            # fast_nav: skip the post-load sleep so the in-app nav (and the
            # air-bounds XHR it triggers) happens BEFORE the ~10-20s window
            # in which Firefox crashes on the redeem SPA.
            await asyncio.sleep(1.5 if fast_nav else 8.0)
            _step("spa_bootstrapped", fast_nav=bool(fast_nav))
            try:
                out["spa_storage"] = await page.evaluate(
                    """() => {
                        const ls = {}, ss = {};
                        try { for (let i=0;i<localStorage.length;i++){
                            const k=localStorage.key(i);
                            ls[k]=(localStorage.getItem(k)||'').slice(0,80);
                        }} catch(e){}
                        try { for (let i=0;i<sessionStorage.length;i++){
                            ss[sessionStorage.key(i)]=1;
                        }} catch(e){}
                        return {
                            cookie: document.cookie.slice(0,500),
                            localStorage_keys: Object.keys(ls),
                            sessionStorage_keys: Object.keys(ss),
                            location: location.href,
                        };
                    }"""
                )
            except Exception as exc:  # noqa: BLE001
                out["spa_storage_error"] = str(exc)[:200]
            for sel in ("#onetrust-accept-btn-handler",
                        "#accept-recommended-btn-handler"):
                try:
                    btn = page.locator(sel)
                    if await btn.count() > 0 and await btn.first.is_visible():
                        await btn.first.click(timeout=4000)
                        await asyncio.sleep(1.5)
                        break
                except Exception:  # noqa: BLE001
                    pass

            if "clogin" in (page.url or ""):
                nav_attempts.append({"step": "clogin_bounce_reload"})
                _step("clogin_bounce")
                await _nav(REDEEM_ROOT, "redeem_root_retry")
                await asyncio.sleep(8.0)

            # In-app SPA navigation to the availability route — no
            # Akamai-protected document request fires.
            spa_path = search_url.split("aircanada.com", 1)[1]
            out["spa_path"] = spa_path
            try:
                await page.evaluate(
                    """(p) => {
                        window.history.pushState({}, '', p);
                        window.dispatchEvent(new PopStateEvent(
                            'popstate', {state: {}}));
                    }""",
                    spa_path,
                )
                nav_attempts.append({"step": "spa_inapp_nav", "path": spa_path})
                _step("spa_inapp_nav")
            except Exception as exc:  # noqa: BLE001
                nav_attempts.append({
                    "step": "spa_inapp_nav", "error": str(exc)[:200]})
        out["nav_attempts"] = nav_attempts

        # Poll for the air-bounds XHR.
        _step("poll_air_bounds_begin", wait_s=wait_s)
        for _ in range(max(1, wait_s)):
            if air_bounds_resps:
                break
            await asyncio.sleep(1.0)
        _step("poll_air_bounds_done", got=len(air_bounds_resps))

        try:
            out["page_url"] = page.url
            out["page_title"] = await page.title()
            out["body_snippet"] = (await page.locator("body").inner_text())[:400]
        except Exception:  # noqa: BLE001
            pass
        _step("flow_complete")
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)[:500]
        out["traceback"] = traceback.format_exc()[-1500:]
        _step("EXCEPTION", err=str(exc)[:200])
    finally:
        # Crash-safe teardown: if Firefox's process already died, close()
        # raises `handler is closed` — swallow it so captured data survives.
        crashed = False
        if browser is not None:
            try:
                await browser.close()
            except Exception as exc:  # noqa: BLE001
                crashed = True
                _step("teardown_close_failed", err=str(exc)[:160])
        # On a crash, read Firefox's own crash-report .extra files (plaintext
        # crash signature) so we can see WHY the process died.
        if crashed or any("handler is closed" in str(s) for s in steps):
            try:
                out["firefox_crash_artifacts"] = _firefox_crash_artifacts()
            except Exception as exc:  # noqa: BLE001
                out["firefox_crash_artifacts_error"] = str(exc)[:200]

    out["steps"] = steps
    out["air_bounds_requests"] = air_bounds_reqs
    out["air_bounds_responses"] = air_bounds_resps
    out["loyalty_urls_seen"] = all_loyalty_urls[:40]
    return JSONResponse({"ok": bool(air_bounds_reqs), **out})


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
    user_id: str | None = Query(
        None,
        description=(
            "Phase 2.5 (T5'): authenticated user UUID. When present, "
            "auth-required plugins (e.g. AC_AEROPLAN) look up the user's "
            "stored program_auth_sessions cookies and replay them. Ignored "
            "by plugins that don't need a login."
        ),
    ),
) -> JSONResponse:
    plugin = PLUGINS.get(program)
    if plugin is None:
        raise HTTPException(status_code=404, detail=f"Unknown program: {program}")

    origin_u = origin.upper()
    dest_u = dest.upper()
    query = SearchQuery(
        origin=origin_u, dest=dest_u, depart_date=date, pax=pax, min_cabin=minCabin  # type: ignore[arg-type]
    )

    # Pass user_id ONLY to plugins whose signature accepts it (T5'
    # auth-capture plugins like AC_AEROPLAN). The other 14 plugins keep the
    # positional 4-arg signature untouched — `inspect.signature` lets us
    # dispatch tolerantly without editing every plugin.
    import inspect

    plugin_kwargs: dict = {}
    try:
        if "user_id" in inspect.signature(plugin).parameters:
            plugin_kwargs["user_id"] = user_id
    except (ValueError, TypeError):
        pass

    try:
        results = await plugin(origin_u, dest_u, date, minCabin, **plugin_kwargs)
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
