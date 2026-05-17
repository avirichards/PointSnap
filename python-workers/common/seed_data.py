"""Canonical JFK→NRT seeds for each launch program — Python port of
src/lib/mockSearch.ts SEEDS.

Each entry is the single "best" result the program would return for
JFK→NRT on a typical search day. Real scrapers replace these per-program
over Sessions 5-10. Day-1 (this commit) just moves the data from the
Next.js mock generator into the Python worker, so the cockpit pulls from
the same source of truth regardless of which program comes online when.

Schedule fields (offset, duration_min) are relative to the query's
depart_date — the helper in mock_plugin.py builds the actual ISO
timestamps at call time.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True, frozen=True)
class SeedSegment:
    operating_airline_iata: str
    marketing_airline_iata: str
    flight_number: str
    origin_iata: str
    dest_iata: str
    depart_offset_min: int  # minutes from 11:10Z baseline on depart_date
    duration_min: int
    aircraft_icao: str
    segment_cabin: str  # Y|W|J|F
    fare_class: str


@dataclass(slots=True, frozen=True)
class SeedCabin:
    cabin: str
    seats_remaining: int
    miles_per_pax: int
    surcharge_usd_per_pax: int
    taxes_usd_per_pax: int
    cpp_micro_at_obs: int | None


@dataclass(slots=True, frozen=True)
class ProgramSeed:
    program_id: str
    program_name: str
    segments: tuple[SeedSegment, ...]
    cabins: tuple[SeedCabin, ...]
    confidence_score: int
    last_seen_minutes_ago: int


# Single canonical JFK→NRT result per program. Faithfully ports the best
# entry per program from src/lib/mockSearch.ts. Programs whose mock had
# multiple results pick the highest-confidence one.

SEEDS_JFK_NRT: dict[str, ProgramSeed] = {
    "NH_ANA": ProgramSeed(
        program_id="NH_ANA",
        program_name="ANA Mileage Club",
        segments=(
            SeedSegment("NH", "NH", "9", "JFK", "NRT", 0, 840, "B77W", "J", "I"),
        ),
        cabins=(
            SeedCabin("Y", 9, 40_000, 0, 36, 1500),
            SeedCabin("J", 3, 75_000, 0, 36, 1700),
            SeedCabin("F", 1, 110_000, 0, 36, 1900),
        ),
        confidence_score=92,
        last_seen_minutes_ago=3,
    ),
    "UA_MP": ProgramSeed(
        program_id="UA_MP",
        program_name="United MileagePlus",
        segments=(
            SeedSegment("NH", "UA", "7901", "JFK", "NRT", 0, 840, "B77W", "J", "I"),
        ),
        cabins=(SeedCabin("J", 3, 88_000, 0, 36, 1400),),
        confidence_score=78,
        last_seen_minutes_ago=7,
    ),
    "AC_AEROPLAN": ProgramSeed(
        program_id="AC_AEROPLAN",
        program_name="Aeroplan",
        segments=(
            SeedSegment("NH", "AC", "5961", "JFK", "NRT", 0, 840, "B77W", "J", "I"),
        ),
        cabins=(
            SeedCabin("J", 3, 75_000, 0, 36, 1500),
            SeedCabin("F", 1, 105_000, 0, 36, 1700),
        ),
        confidence_score=81,
        last_seen_minutes_ago=12,
    ),
    "AV_LIFEMILES": ProgramSeed(
        program_id="AV_LIFEMILES",
        program_name="Avianca LifeMiles",
        segments=(
            SeedSegment("NH", "AV", "9001", "JFK", "NRT", 0, 840, "B77W", "J", "I"),
        ),
        cabins=(SeedCabin("J", 3, 78_000, 0, 90, 1300),),
        confidence_score=70,
        last_seen_minutes_ago=18,
    ),
    "AA_AADVANTAGE": ProgramSeed(
        program_id="AA_AADVANTAGE",
        program_name="AAdvantage",
        segments=(
            SeedSegment("JL", "AA", "8412", "JFK", "NRT", 60, 840, "B77W", "J", "X"),
        ),
        cabins=(
            SeedCabin("J", 2, 60_000, 0, 27, 1500),
            SeedCabin("F", 1, 80_000, 0, 27, 1500),
        ),
        confidence_score=86,
        last_seen_minutes_ago=15,
    ),
    "AS_MILEAGEPLAN": ProgramSeed(
        program_id="AS_MILEAGEPLAN",
        program_name="Alaska Mileage Plan",
        segments=(
            SeedSegment("JL", "AS", "8821", "JFK", "NRT", 60, 840, "B77W", "J", "X"),
        ),
        cabins=(
            SeedCabin("J", 2, 65_000, 0, 27, 1800),
            SeedCabin("F", 1, 70_000, 0, 27, 1800),
        ),
        confidence_score=88,
        last_seen_minutes_ago=20,
    ),
    "BA_AVIOS": ProgramSeed(
        program_id="BA_AVIOS",
        program_name="British Airways Avios",
        segments=(
            SeedSegment("JL", "BA", "7301", "JFK", "NRT", 60, 840, "B77W", "J", "X"),
        ),
        cabins=(
            SeedCabin("J", 2, 100_000, 580, 65, 1500),
            SeedCabin("F", 1, 145_000, 720, 65, 1500),
        ),
        confidence_score=68,
        last_seen_minutes_ago=29,
    ),
    "AF_FLYINGBLUE": ProgramSeed(
        program_id="AF_FLYINGBLUE",
        program_name="Flying Blue",
        segments=(
            SeedSegment("AF", "AF", "11", "JFK", "CDG", 420, 420, "B789", "W", "A"),
            SeedSegment("AF", "AF", "276", "CDG", "NRT", 1080, 720, "B77W", "J", "I"),
        ),
        cabins=(
            SeedCabin("W", 3, 65_000, 295, 104, 1300),
            SeedCabin("J", 2, 100_000, 380, 104, 1300),
        ),
        confidence_score=67,
        last_seen_minutes_ago=40,
    ),
    "TK_MILES_SMILES": ProgramSeed(
        program_id="TK_MILES_SMILES",
        program_name="Turkish Miles&Smiles",
        segments=(
            SeedSegment("TK", "TK", "12", "JFK", "IST", 360, 600, "B77W", "J", "I"),
            SeedSegment("TK", "TK", "198", "IST", "NRT", 1170, 720, "B789", "J", "I"),
        ),
        cabins=(
            SeedCabin("Y", 9, 47_500, 0, 76, 1300),
            SeedCabin("J", 4, 87_500, 0, 76, 1400),
        ),
        confidence_score=38,
        last_seen_minutes_ago=95,
    ),
    "DL_SKYMILES": ProgramSeed(
        program_id="DL_SKYMILES",
        program_name="Delta SkyMiles",
        segments=(
            SeedSegment("DL", "DL", "159", "JFK", "NRT", 180, 840, "A359", "J", "Z"),
        ),
        cabins=(
            SeedCabin("Y", 9, 95_000, 0, 41, 1200),
            SeedCabin("J", 4, 285_000, 0, 41, 1100),
        ),
        confidence_score=55,
        last_seen_minutes_ago=68,
    ),
    "CX_CATHAY": ProgramSeed(
        program_id="CX_CATHAY",
        program_name="Cathay Asia Miles",
        segments=(
            SeedSegment("CX", "CX", "841", "JFK", "HKG", 240, 960, "A35K", "J", "D"),
            SeedSegment("CX", "CX", "548", "HKG", "NRT", 1320, 240, "A333", "J", "D"),
        ),
        cabins=(
            SeedCabin("J", 2, 90_000, 285, 102, 1400),
            SeedCabin("F", 1, 145_000, 410, 102, 1600),
        ),
        confidence_score=76,
        last_seen_minutes_ago=79,
    ),
    "LH_MILES_MORE": ProgramSeed(
        program_id="LH_MILES_MORE",
        program_name="Miles & More (partner-inferred)",
        segments=(
            SeedSegment("LH", "LH", "401", "JFK", "FRA", 540, 420, "A359", "F", "A"),
            SeedSegment("LH", "LH", "716", "FRA", "NRT", 1170, 720, "B748", "F", "A"),
        ),
        cabins=(SeedCabin("F", 1, 110_000, 850, 145, 1900),),
        confidence_score=22,
        last_seen_minutes_ago=240,
    ),
}
