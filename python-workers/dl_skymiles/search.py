"""Delta SkyMiles award search plugin.

REAL SCRAPE PENDING — DataDome + fully dynamic pricing.

Research findings (Session 5 agent, verified via AwardWiz delta.ts —
archived Sept 2024, marked "temp broken"):

  Endpoints:
  - Login: POST https://www.delta.com/profile-gateway/login
    Body: { username: "<SkyMiles#|email>", password: "<pw>" }
    Sets dltaSessionId, DL_SESS, datadome cookies.
    SPECULATIVE on exact endpoint name — verify in DevTools.
  - Login UI hosted at https://www.delta.com/skymiles/login.
  - Browse without login returns CASH prices but clamps award/miles to
    null. Login REQUIRED for accurate miles pricing.

  - SEARCH endpoint:
    POST https://www.delta.com/shop/ow/search (one-way) or /shop/rt/
    search (round-trip). Also /shop/ow/flexdatesearch for flex calendar.
    Headers: Content-Type/Accept JSON, session cookies (DL_SESS,
    datadome, JSESSIONID).
    Body (inferred — SPECULATIVE):
    { "selectTripType":"OW","awardTravel":true,
      "passengerInfo":[{"count":1,"type":"ADT"}],
      "tripOriginAirportCode":"JFK","tripDestinationAirportCode":"CDG",
      "departureDate":"YYYY-MM-DD","cabinFareClass":"BE",
      "shopType":"MILES","searchByCabin":true,
      "flexAirportRadius":"nonStop","numberOfResults":50 }

  Response: itinerary[].fareOffer[] — each fareOffer has totalPrice.
  miles.miles + brandInfoByFlightLegs[].cos[]. "O" = Delta One/J;
  everything else = economy. Partner metal (KE/AF/KL/VA/AS) under same
  shape; marketingCarrier.code identifies. PURE DYNAMIC since 2015 —
  no chart, miles vary with demand.

  Anti-bot: DataDome. Combines server-side challenge cookie (datadome),
  JA3/JA4, canvas/WebGL/AudioContext fingerprinting, and 2025-new
  intent-based behavioral detection. Cookie is signed — cannot be forged
  client-side; must be earned via real JS execution.
  curl_cffi alone INSUFFICIENT. Patchright mandatory for every warm
  session.

To implement (next session with account creds):
  fly secrets set DL_USER="..." DL_PASS="..."

  1. Prime in Patchright with stealth patches, residential sticky IP,
     real UA matching impersonation target. Load delta.com/flight-search/
     book-a-flight, let DataDome JS run to completion.
  2. Login with warmed SkyMiles account; persist cookie jar (esp.
     datadome, DL_SESS).
  3. Submit FIRST search via rendered form (#chkFlexDate + #btnSubmit)
     — gives DataDome a "human" navigation pattern + warms /shop/ow/
     search. Then switch to direct JSON POST for follow-ups.
  4. Throttle: 3-5s jitter, max ~10 searches per warm session. Watch
     for system-unavailable1.html redirect + error ITA404Error3Award
     → cooldown 10+ min, re-prime.
  5. Parse itinerary[].fareOffer[], deduplicate by
     brandInfoByFlightLegs[0].cos[0] keeping lowest totalPrice.miles.miles
     per cabin. Treat miles values as DYNAMIC — never cache as "chart
     price."

Until then, returns canonical seed (DL159 JFK→NRT A359) via
canonical-fallback wrapper.
"""

from __future__ import annotations

import logging

from common.plugin_wrapper import with_canonical_fallback
from common.types import NormalizedResult

log = logging.getLogger(__name__)
PROGRAM_ID = "DL_SKYMILES"


async def _scrape_real(
    origin: str,
    dest: str,
    date: str,
    cabin_filter: str = "Y",
) -> list[NormalizedResult]:
    """PENDING Patchright + DataDome bypass + SkyMiles auth. See module docstring."""
    return []


search = with_canonical_fallback(PROGRAM_ID, _scrape_real)
