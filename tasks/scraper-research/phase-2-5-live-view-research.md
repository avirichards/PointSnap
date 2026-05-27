# Phase 2.5 — Live-View URL Research

**Owner:** Phase 2.5 backend agent (this dispatch).
**Status:** Open / partially resolved. Needs live verification against a real
`BRIGHTDATA_WSS_URL`.
**File of interest:** `python-workers/auth/capture.py:_get_live_view_url()`.

## The problem

`/auth/start` needs to return a URL the cockpit can embed in an `<iframe>` so
the user can interact with the airline's login page directly. The HTTP user is
sitting on `pointsnap.app`; the browser is running on Bright Data's
infrastructure (we connect to it via `wss://...brightdata.com` CDP).

We need a "live view" of the BD browser — a page that:
1. Renders what the BD browser is rendering, in near real-time
2. Forwards keyboard + mouse events from the iframe back to the BD browser
3. Can be embedded cross-origin (no `X-Frame-Options: DENY` from BD's side)

## Three candidate approaches

### 1. BD's native `Page.inspect` CDP method (canonical — *try first*)

Bright Data extends CDP with a non-standard method `Page.inspect` that returns
an `inspectorUrl` field. This URL is a BD-hosted Chrome DevTools session
proxied through `api.brightdata.com` — it bypasses the
`chrome-devtools-frontend.appspot.com` CORS limitations and BD's own
IP-whitelist controls.

Implementation in `_get_live_view_url()`:
```python
cdp = await page.context.new_cdp_session(page)
result = await cdp.send("Page.inspect")
url = result.get("inspectorUrl")  # or "url" / "inspector_url"
```

**Status:** Implemented. **Untested against live BD WSS.** May need adjustment
of the result-key name based on what BD actually returns. The result may
also need a session-scoped auth token appended.

**Risks:**
- Some BD plan tiers gate live-view behind a separate add-on
- BD docs mention the URL is "single-use" — re-issuing on session reconnect
  may be needed
- Cross-origin iframe embedding from `api.brightdata.com` may require explicit
  allow-list in BD dashboard

**Verification plan:**
```bash
# From a worker shell with BRIGHTDATA_WSS_URL set:
python -c "
import asyncio, os
from patchright.async_api import async_playwright
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.connect_over_cdp(os.environ['BRIGHTDATA_WSS_URL'])
        ctx = b.contexts[0]
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.goto('https://example.com')
        cdp = await ctx.new_cdp_session(page)
        result = await cdp.send('Page.inspect')
        print('Page.inspect result:', result)
        await b.close()
asyncio.run(main())
"
```

Then literally paste the returned URL into a browser tab. If it loads a Chrome
DevTools-style view of example.com that responds to clicks, we're done — wire
it through to the cockpit iframe.

### 2. Chrome DevTools frontend + raw wss URL (fallback — *implemented*)

If method 1 fails, we extract `webSocketDebuggerUrl` from CDP
`Target.getTargetInfo` and assemble a DevTools URL via Google's hosted
frontend:
```
https://chrome-devtools-frontend.appspot.com/serve_internal_file/@latest/inspector.html?wss=<host-and-path>
```

**Risks:**
- Google hosts this for browser debugging, not user-facing flows. They may
  deprecate or rate-limit. Stability is not guaranteed.
- The hosted frontend may not work cross-origin from `pointsnap.app` because
  BD's wss endpoint enforces an Origin/Host check.
- The DevTools UI is busy — not ideal UX for "log in here." We'd want to add
  a CSS overlay to hide everything except the rendered viewport, but doing
  that inside a cross-origin iframe is impossible without a
  developer-mode-only workaround.

### 3. Worker-side screenshot streaming + input replay (clean-room, *not built*)

If both 1 and 2 fall through, the right longer-term architecture is:
- Worker `/auth/start` returns a stable session_id (already does)
- Cockpit opens a websocket to `/auth/stream?session_id=...`
- Worker pushes ~5fps PNG/JPEG screenshots via that websocket
- Cockpit captures mouse + keyboard events on a `<canvas>`, posts them as JSON
  to `/auth/input?session_id=...`
- Worker forwards them via CDP `Input.dispatchMouseEvent` /
  `Input.dispatchKeyEvent`

**Pros:**
- Zero dependency on BD's live-view or Google's hosted DevTools
- Full control over UX (we can crop to just the viewport, hide the URL bar)
- Works for any CDP target (also opens the door to streaming Camoufox/Firefox)

**Cons:**
- More code to write (~200-300 LoC of websocket plumbing)
- Bandwidth: ~30-100 KB per second per session at 5fps
- Latency: visible (200-400ms round-trip)
- Input fidelity: composition input, paste, scrollwheel quirks per browser

**When to build:** if methods 1 + 2 both fail in real BD testing. The router
in `auth/capture.py` already maintains the live `page` handle across HTTP
requests, so the screenshot endpoint would just add `/auth/stream` and
`/auth/input` routes that reuse `ACTIVE_SESSIONS[session_id].page`.

## What's shipped in this dispatch

- `_get_live_view_url(page)` in `auth/capture.py` tries methods 1 → 2 in order
- `/auth/start` returns `{ live_view_url, live_view_available }` — `TBD` /
  `false` when both fail
- The cockpit modal should detect `live_view_available == false` and show a
  "we're working on the live view" placeholder rather than a broken iframe

## What's needed to fully close this out

1. **Live test against real BD WSS URL** (~5min once `BRIGHTDATA_WSS_URL` is
   set as a Fly secret). Confirms which method works.
2. **Decision: which key from BD's response carries the URL?** (Likely
   `inspectorUrl` but `url` or `inspector_url` are plausible too — code
   tolerates all three.)
3. **Cross-origin iframe test from the live cockpit domain** — confirm the
   embedded URL actually renders inside the modal.
4. **If both fail: build method 3.** Add `/auth/stream` + `/auth/input`
   routes that reuse `ACTIVE_SESSIONS[session_id]`.

Tracking this as an open angle in `tasks/scraper-log.md` Session 11 next
update.
