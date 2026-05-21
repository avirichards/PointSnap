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

THE PATCH — two complementary edits:

1. The SOURCE fix (`FFPage._onUncaughtError`): the Firefox session builds
   the page-error from the Juggler `Page.uncaughtError` event and calls
   `this._page.addPageError(error, params2.location)` — but `params2.
   location` is `undefined` for some uncaught errors. Default it to a
   well-formed, TYPE-CORRECT object so the whole downstream chain is sound:
       params2.location
         -> params2.location || { url: "", lineNumber: 0, columnNumber: 0 }
   This matters because Playwright's protocol validator (`tString` /
   `tNumber`) rejects an `undefined` `location.url` with
   `ValidationError: location.url: expected string, got undefined` — which
   ALSO crashes the Node driver. So the default must be `url:""` (a
   string), `lineNumber:0` / `columnNumber:0` (numbers), not just any
   truthy object.

2. The defensive member-access fix (kept as belt-and-braces): every
   `pageError.location.X` -> `(pageError.location||{}).X`. With edit (1)
   in place `pageError.location` is never undefined so this is a no-op,
   but it costs nothing and guards the two dispatch sites directly.

Both edits are behaviour-preserving and idempotent (re-running finds
nothing to replace). Run at Docker build time, after `pip install` has
installed playwright. Exits 0 even if nothing matched (e.g. a future
Playwright that already fixed this) so the build never breaks on it.
"""

from __future__ import annotations

import glob
import sys

# Edit (1) — the source fix in FFPage._onUncaughtError — plus edit (2) —
# the defensive member-access guards. All are exact-substring replacements:
# order-independent, whitespace-tolerant within the matched substring, and
# safe to run twice.
REPLACEMENTS = [
    # (1) SOURCE fix: default the undefined Juggler event `location` to a
    #     type-correct object (url:string, lineNumber/columnNumber:number).
    (
        "this._page.addPageError(error, params2.location);",
        "this._page.addPageError(error, params2.location || "
        '{ url: "", lineNumber: 0, columnNumber: 0 });',
    ),
    # (2) defensive member-access guards at the two dispatch sites.
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
