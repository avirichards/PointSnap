"""American AAdvantage award search plugin.

REAL SCRAPE PENDING — Shape Security + Patchright session hijack pattern.

Research findings (Session 5 agent, verified via AwardWiz aa.ts):

  Endpoints:
  - Login: POST https://www.aa.com/loyalty/login/api/account/login
    Body: { loginID: "<AAdvantage#>", password: "<pw>", rememberMe: false }
    Sets cookies: aa-loginflow, JSESSIONID_AA, plus Shape-signed _abck/bm_sz.
  - SEARCH (verified body shape): POST https://www.aa.com/booking/api/
    search/itinerary
    Headers: Content-Type/Accept JSON, X-Cobrand, X-AAdvantage-Number
    (logged in), dynamically computed Bm-So-V-D / Shape Bm-V-S tokens
    from page JS.

  Body (verified):
  {
    "metadata":{"selectedProducts":[],"tripType":"OneWay","udo":{}},
    "passengers":[{"type":"adult","count":1}],
    "queryParams":{"sliceIndex":0,"sessionId":"","solutionId":"","solutionSet":""},
    "requestHeader":{"clientId":"AAcom"},
    "slices":[{"allCarriers":true,"cabin":"","departureDate":"YYYY-MM-DD",
              "destination":"LHR","origin":"JFK","departureTime":"040001",
              "includeNearbyAirports":false}],
    "tripOptions":{"locale":"en_US","searchType":"Award"},
    "loyaltyInfo":null
  }

  Response: slices[].segments[].flight + legs + pricingDetail[].
  Fare codes: F/J/W/Y paid; Z/U/T/X award (Z/U = business saver/Web
  Special, T/X = econ saver/Web Special). extendedFareCode ===
  "WEBSPECIAL" flags dynamic off-chart price.
  Browse without login returns AA-metal awards. Partner inventory
  (BA/JL/QR/QF/CX) better with login.

  Anti-bot: Shape Security (F5). VM JS obfuscation + JA3/JA4 + behavioral.
  curl_cffi alone fails on _abck after ~3 requests.
  Working approach: Patchright primes _abck (load aa.com/booking, submit
  one throwaway search), then HIJACK SESSION into curl_cffi for ~50-call
  burst before re-priming. Each warm session ~30-60 min before Shape
  rotates the token.

To implement (next session with account creds):
  fly secrets set AA_USER="..." AA_PASS="..."

  1. Prime with Patchright headed in residential IP — load aa.com/
     booking/find-flights, submit throwaway search so _abck becomes valid.
  2. Login if you need partner inventory; persist cookie jar to disk
     keyed by AAdvantage #.
  3. HIJACK SESSION into curl_cffi with impersonate="chrome131" + full
     cookie jar; reuse for batched POSTs.
  4. Detect re-challenge: HTTP 412 OR 200 with empty slices +
     errorNumber 1100/309. Re-prime in Patchright (don't retry blindly).
  5. Parse pricingDetail[], surfacing productType + perPassengerAwardPoints
     + extendedFareCode === "WEBSPECIAL" separately so Web Special vs
     Saver is preserved.

Until then, returns canonical seed (AA JL-coded JFK→NRT) via
canonical-fallback wrapper.
"""

from __future__ import annotations

import logging

from common.plugin_wrapper import with_canonical_fallback
from common.types import NormalizedResult

log = logging.getLogger(__name__)
PROGRAM_ID = "AA_AADVANTAGE"


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """PENDING Patchright session hijack + Shape bypass. See module docstring."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
