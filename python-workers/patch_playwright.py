"""Build-time patch for a Playwright Firefox driver crash.

THE BUG (Playwright 1.60, Firefox/Camoufox transport):
    coreBundle.js  ->  `url: pageError.location.url`  (two occurrences)
When a page raises an uncaught JS error whose Firefox page-error event has
an undefined `location`, Playwright's Firefox page-error handler does
`pageError.location.url` with no null-check. That throws
`TypeError: Cannot read properties of undefined (reading 'url')` — an
*unhandled* exception in the Node driver, so the **entire Playwright Node
driver process exits**. The Python side then loses its stdio pipe and
every subsequent call fails `Connection closed while reading from the
driver` / `WriteUnixTransport closed`.

Air Canada's aeroplan/redeem SPA (+ Kasada `p.js`, + the mPulse beacon)
raises exactly such an uncaught error within ~2-4s of load, so the AC
redeem transport could not survive long enough to capture the air-bounds
XHR. A page-level `error`-event `preventDefault()` shield does NOT help —
Firefox's Juggler protocol emits the page-error telemetry at the JS-engine
level, before the page's own `error` handlers run. The only real fix is to
null-guard the driver code itself.

THE PATCH:
    pageError.location.url           ->  (pageError.location||{}).url
    pageError.location.lineNumber    ->  (pageError.location||{}).lineNumber
    pageError.location.columnNumber  ->  (pageError.location||{}).columnNumber

`(undefined||{}).url` is `undefined` (no crash); `({url:'x'}).url` is `'x'`
(unchanged when a location IS present). Behaviour-preserving, idempotent
(re-running finds nothing to replace), and scoped to exactly the crash.

Run at Docker build time, after `pip install` has installed playwright.
Exits 0 even if nothing matched (e.g. a future Playwright that already
fixed this) so the build never breaks on it.
"""

from __future__ import annotations

import glob
import sys

# Both the (older) `pageError.location.url` shape and any whitespace
# variant collapse to the same three member accesses. We replace the
# member-access expressions directly — order-independent, whitespace-
# independent, and safe to run twice.
REPLACEMENTS = [
    ("pageError.location.url", "(pageError.location||{}).url"),
    ("pageError.location.lineNumber", "(pageError.location||{}).lineNumber"),
    ("pageError.location.columnNumber", "(pageError.location||{}).columnNumber"),
]

BUNDLE_GLOBS = [
    "/usr/local/lib/python*/site-packages/playwright/driver/package/lib/coreBundle.js",
    "/usr/lib/python*/site-packages/playwright/driver/package/lib/coreBundle.js",
    # Defensive: some layouts ship the driver under .../driver/package/lib/.
    "/usr/local/lib/python*/*-packages/playwright/driver/**/coreBundle.js",
]


def main() -> int:
    files: set[str] = set()
    for pat in BUNDLE_GLOBS:
        files.update(glob.glob(pat, recursive=True))

    if not files:
        print("patch_playwright: no coreBundle.js found — skipping (non-fatal)")
        return 0

    total_patched = 0
    for fp in sorted(files):
        try:
            with open(fp, encoding="utf-8") as f:
                src = f.read()
        except Exception as exc:  # noqa: BLE001
            print(f"patch_playwright: cannot read {fp}: {exc}")
            continue

        patched = src
        per_file = 0
        for old, new in REPLACEMENTS:
            if old in patched:
                n = patched.count(old)
                patched = patched.replace(old, new)
                per_file += n

        if per_file:
            try:
                with open(fp, "w", encoding="utf-8") as f:
                    f.write(patched)
                total_patched += per_file
                print(f"patch_playwright: patched {per_file} occurrence(s) in {fp}")
            except Exception as exc:  # noqa: BLE001
                print(f"patch_playwright: cannot write {fp}: {exc}")
                return 1
        else:
            print(f"patch_playwright: nothing to patch in {fp} "
                  "(already patched or Playwright fixed it upstream)")

    print(f"patch_playwright: done — {total_patched} total replacement(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
