"""Per-carrier award booking window (max days from today a search is valid).

Sources: each airline's published award booking window. Carriers open
award inventory a fixed number of days ahead; querying past that returns
empty or errors. The cockpit calendar uses these to disable out-of-window
dates per program.

The cockpit reads these via the worker's ``/programs/meta`` endpoint
(``serve.py``). Numbers below were cross-checked 2026-05-20 against two
aggregator tables that track release dates across 30+ programs:

  * AwardFares "Ultimate Guide to Award Release Dates"
    https://awardfares.com/blog/ultimate-guide-to-award-release-dates/
  * AwardWallet "How Far in Advance Can You Book Airline Award Tickets?"
    https://awardwallet.com/airlines/far-advance-can-book-airline-award-tickets/

These windows drift (carriers re-tune them, leap years shift by a day,
calendars sometimes toggle a few days further than the default). They are
deliberately treated as APPROXIMATE — the cockpit only uses them to grey
out clearly out-of-window dates, not as a hard booking gate. When two
sources disagreed, the value below favors the larger / Star-Alliance-norm
figure unless both sources agreed on the smaller one, so the calendar
errs toward *allowing* a search rather than wrongly blocking a valid date.

Per-program source notes (only where a value was changed from an earlier
estimate or where sources disagreed):

  * BA_AVIOS    354  — AwardWallet 354; British Airways Executive Club.
  * TK_MILES_SMILES 355 — sources split (AwardWallet 355 / AwardFares 331);
                          took 355, the Star Alliance norm and the larger
                          value, to avoid wrongly blocking valid dates.
  * AV_LIFEMILES 360 — both aggregators agree 360 (one of the longest
                       windows); corrected up from a 330 estimate.
  * EK_SKYWARDS 355 — sources split (calendar opens ~328, aggregators cite
                      360); 355 is a mid-range conservative value.
  * QR_PRIVILEGE 354 — AwardWallet 354 (Qatar Privilege Club).
  * ET_SHEBAMILES 331 — AwardWallet 331 (Ethiopian ShebaMiles).
  * EY_GUEST    331 — AwardWallet / AwardFares both ~330-331.
  * CM_CONNECTMILES 337 — AwardWallet 337 (Copa ConnectMiles).
  * AM_CLUB_PREMIER 330 — both aggregators agree 330 (Aeromexico Rewards).
  * SV_ALFURSAN 330 — Saudia AlFursan releases ~330 days out.
  * VA_VELOCITY 332 — AwardWallet 332 (Virgin Australia Velocity).

Everything not annotated above was consistent across both sources.
"""

# Max days from today that each program accepts award searches for.
PROGRAM_MAX_DAYS_OUT: dict[str, int] = {
    "AA_AADVANTAGE": 331,
    "UA_MP": 337,
    "DL_SKYMILES": 331,
    "AC_AEROPLAN": 355,
    "BA_AVIOS": 354,
    "AF_FLYINGBLUE": 360,
    "VS_FLYING_CLUB": 331,
    "AS_MILEAGEPLAN": 331,
    "LH_MILES_MORE": 360,
    "NH_ANA": 355,
    "TK_MILES_SMILES": 355,
    "CX_CATHAY": 360,
    "AV_LIFEMILES": 360,
    "B6_TRUEBLUE": 331,
    "QF_FF": 353,
    "EK_SKYWARDS": 355,
    "QR_PRIVILEGE": 354,
    "SQ_KRISFLYER": 355,
    "SK_EUROBONUS": 360,
    "AY_FINNAIR_PLUS": 360,
    "ET_SHEBAMILES": 331,
    "EY_GUEST": 331,
    "CM_CONNECTMILES": 337,
    "AM_CLUB_PREMIER": 330,
    "AD_AZUL_TUDOAZUL": 330,
    "G3_GOL_SMILES": 330,
    "SV_ALFURSAN": 330,
    "VA_VELOCITY": 332,
}

# Conservative fallback for any program id not in the table above. 330 is
# the shortest window any tracked carrier uses, so an unlisted program
# never advertises a window longer than the data supports.
DEFAULT_MAX_DAYS_OUT = 330


def max_days_out(program_id: str) -> int:
    """Return the award booking window (days from today) for a program.

    Falls back to ``DEFAULT_MAX_DAYS_OUT`` for any unrecognized id, so a
    caller never has to special-case a missing program.
    """
    return PROGRAM_MAX_DAYS_OUT.get(program_id, DEFAULT_MAX_DAYS_OUT)
