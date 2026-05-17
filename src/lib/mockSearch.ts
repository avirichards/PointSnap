import { itineraryHash, operatingFlightKey } from "./itineraryHash";
import type {
  Cabin,
  CabinPrice,
  ResultSegment,
  SearchQuery,
  SearchResultRow,
} from "./types";

const NOW = () => new Date();

const minutesAgo = (n: number) =>
  new Date(NOW().getTime() - n * 60_000).toISOString();

interface MockSeed {
  programId: string;
  programName: string;
  segments: Array<Omit<ResultSegment, "segmentOrder">>;
  cabins: Partial<Record<Cabin, Omit<CabinPrice, "cabin">>>;
  confidenceScore: number;
  /** Minutes ago the result was last observed. */
  lastSeenMinutesAgo: number;
}

const departBase = (offsetMin: number) => {
  const base = new Date();
  base.setUTCHours(11, 10, 0, 0);
  base.setUTCDate(base.getUTCDate() + 14);
  return new Date(base.getTime() + offsetMin * 60_000).toISOString();
};

/** Hand-curated JFK -> NRT dataset, ~30 rows, stress-testing every UI affordance. */
const SEEDS: MockSeed[] = [
  // ANA NH9 nonstop, all-four (Star)
  {
    programId: "NH_ANA",
    programName: "ANA Mileage Club",
    segments: [
      {
        operatingAirlineIata: "NH",
        marketingAirlineIata: "NH",
        flightNumber: "9",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(0),
        arriveAt: departBase(14 * 60),
        aircraftIcao: "B77W",
        segmentCabin: "J",
        fareClass: "I",
      },
    ],
    cabins: {
      Y: { seatsRemaining: 9, milesPerPax: 40000, surchargeUsdPerPax: 0, taxesUsdPerPax: 36, cppMicroAtObs: 1500 },
      J: { seatsRemaining: 3, milesPerPax: 75000, surchargeUsdPerPax: 0, taxesUsdPerPax: 36, cppMicroAtObs: 1700 },
      F: { seatsRemaining: 1, milesPerPax: 110000, surchargeUsdPerPax: 0, taxesUsdPerPax: 36, cppMicroAtObs: 1900 },
    },
    confidenceScore: 92,
    lastSeenMinutesAgo: 3,
  },
  {
    programId: "UA_MP",
    programName: "United MileagePlus",
    segments: [
      {
        operatingAirlineIata: "NH",
        marketingAirlineIata: "UA",
        flightNumber: "7901",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(0),
        arriveAt: departBase(14 * 60),
        aircraftIcao: "B77W",
        segmentCabin: "J",
        fareClass: "I",
      },
    ],
    cabins: {
      J: { seatsRemaining: 3, milesPerPax: 88000, surchargeUsdPerPax: 0, taxesUsdPerPax: 36, cppMicroAtObs: 1400 },
    },
    confidenceScore: 78,
    lastSeenMinutesAgo: 7,
  },
  {
    programId: "AC_AEROPLAN",
    programName: "Aeroplan",
    segments: [
      {
        operatingAirlineIata: "NH",
        marketingAirlineIata: "AC",
        flightNumber: "5961",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(0),
        arriveAt: departBase(14 * 60),
        aircraftIcao: "B77W",
        segmentCabin: "J",
        fareClass: "I",
      },
    ],
    cabins: {
      J: { seatsRemaining: 3, milesPerPax: 75000, surchargeUsdPerPax: 0, taxesUsdPerPax: 36, cppMicroAtObs: 1500 },
      F: { seatsRemaining: 1, milesPerPax: 105000, surchargeUsdPerPax: 0, taxesUsdPerPax: 36, cppMicroAtObs: 1700 },
    },
    confidenceScore: 81,
    lastSeenMinutesAgo: 12,
  },
  {
    programId: "AV_LIFEMILES",
    programName: "Avianca LifeMiles",
    segments: [
      {
        operatingAirlineIata: "NH",
        marketingAirlineIata: "AV",
        flightNumber: "9001",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(0),
        arriveAt: departBase(14 * 60),
        aircraftIcao: "B77W",
        segmentCabin: "J",
        fareClass: "I",
      },
    ],
    cabins: {
      J: { seatsRemaining: 3, milesPerPax: 78000, surchargeUsdPerPax: 0, taxesUsdPerPax: 90, cppMicroAtObs: 1300 },
    },
    confidenceScore: 70,
    lastSeenMinutesAgo: 18,
  },

  // United UA79 EWR-NRT (treat as JFK proxy in our route)
  {
    programId: "UA_MP",
    programName: "United MileagePlus",
    segments: [
      {
        operatingAirlineIata: "UA",
        marketingAirlineIata: "UA",
        flightNumber: "79",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(120),
        arriveAt: departBase(120 + 14 * 60),
        aircraftIcao: "B789",
        segmentCabin: "J",
        fareClass: "I",
      },
    ],
    cabins: {
      Y: { seatsRemaining: 4, milesPerPax: 70000, surchargeUsdPerPax: 0, taxesUsdPerPax: 28, cppMicroAtObs: 1400 },
      W: { seatsRemaining: 2, milesPerPax: 110000, surchargeUsdPerPax: 0, taxesUsdPerPax: 28, cppMicroAtObs: 1500 },
      J: { seatsRemaining: 2, milesPerPax: 145000, surchargeUsdPerPax: 0, taxesUsdPerPax: 28, cppMicroAtObs: 1400 },
    },
    confidenceScore: 65,
    lastSeenMinutesAgo: 22,
  },
  {
    programId: "AC_AEROPLAN",
    programName: "Aeroplan",
    segments: [
      {
        operatingAirlineIata: "UA",
        marketingAirlineIata: "AC",
        flightNumber: "5810",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(120),
        arriveAt: departBase(120 + 14 * 60),
        aircraftIcao: "B789",
        segmentCabin: "J",
        fareClass: "I",
      },
    ],
    cabins: {
      Y: { seatsRemaining: 4, milesPerPax: 35000, surchargeUsdPerPax: 0, taxesUsdPerPax: 28, cppMicroAtObs: 1500 },
      J: { seatsRemaining: 2, milesPerPax: 85000, surchargeUsdPerPax: 0, taxesUsdPerPax: 28, cppMicroAtObs: 1500 },
    },
    confidenceScore: 74,
    lastSeenMinutesAgo: 31,
  },

  // JL nonstop, AA + AS + BA partner. BA pricing high YQ.
  {
    programId: "AA_AADVANTAGE",
    programName: "AAdvantage",
    segments: [
      {
        operatingAirlineIata: "JL",
        marketingAirlineIata: "AA",
        flightNumber: "8412",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(60),
        arriveAt: departBase(60 + 14 * 60),
        aircraftIcao: "B77W",
        segmentCabin: "J",
        fareClass: "X",
      },
    ],
    cabins: {
      J: { seatsRemaining: 2, milesPerPax: 60000, surchargeUsdPerPax: 0, taxesUsdPerPax: 27, cppMicroAtObs: 1500 },
      F: { seatsRemaining: 1, milesPerPax: 80000, surchargeUsdPerPax: 0, taxesUsdPerPax: 27, cppMicroAtObs: 1500 },
    },
    confidenceScore: 86,
    lastSeenMinutesAgo: 4,
  },
  {
    programId: "AS_MILEAGEPLAN",
    programName: "Alaska Mileage Plan",
    segments: [
      {
        operatingAirlineIata: "JL",
        marketingAirlineIata: "AS",
        flightNumber: "8821",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(60),
        arriveAt: departBase(60 + 14 * 60),
        aircraftIcao: "B77W",
        segmentCabin: "J",
        fareClass: "X",
      },
    ],
    cabins: {
      J: { seatsRemaining: 2, milesPerPax: 65000, surchargeUsdPerPax: 0, taxesUsdPerPax: 27, cppMicroAtObs: 1800 },
      F: { seatsRemaining: 1, milesPerPax: 70000, surchargeUsdPerPax: 0, taxesUsdPerPax: 27, cppMicroAtObs: 1800 },
    },
    confidenceScore: 88,
    lastSeenMinutesAgo: 5,
  },
  {
    programId: "BA_AVIOS",
    programName: "British Airways Avios",
    segments: [
      {
        operatingAirlineIata: "JL",
        marketingAirlineIata: "BA",
        flightNumber: "7301",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(60),
        arriveAt: departBase(60 + 14 * 60),
        aircraftIcao: "B77W",
        segmentCabin: "J",
        fareClass: "X",
      },
    ],
    cabins: {
      J: { seatsRemaining: 2, milesPerPax: 100000, surchargeUsdPerPax: 580, taxesUsdPerPax: 65, cppMicroAtObs: 1500 },
      F: { seatsRemaining: 1, milesPerPax: 145000, surchargeUsdPerPax: 720, taxesUsdPerPax: 65, cppMicroAtObs: 1500 },
    },
    confidenceScore: 68,
    lastSeenMinutesAgo: 14,
  },

  // Delta own-metal (dynamic, low confidence due to volatility)
  {
    programId: "DL_SKYMILES",
    programName: "Delta SkyMiles",
    segments: [
      {
        operatingAirlineIata: "DL",
        marketingAirlineIata: "DL",
        flightNumber: "159",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(180),
        arriveAt: departBase(180 + 14 * 60),
        aircraftIcao: "A359",
        segmentCabin: "J",
        fareClass: "Z",
      },
    ],
    cabins: {
      Y: { seatsRemaining: 9, milesPerPax: 95000, surchargeUsdPerPax: 0, taxesUsdPerPax: 41, cppMicroAtObs: 1200 },
      J: { seatsRemaining: 4, milesPerPax: 285000, surchargeUsdPerPax: 0, taxesUsdPerPax: 41, cppMicroAtObs: 1100 },
    },
    confidenceScore: 55,
    lastSeenMinutesAgo: 8,
  },
  // Virgin Atlantic via Delta partner (sweet spot)
  {
    programId: "VS_FLYING_CLUB",
    programName: "Virgin Atlantic",
    segments: [
      {
        operatingAirlineIata: "DL",
        marketingAirlineIata: "VS",
        flightNumber: "8801",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(180),
        arriveAt: departBase(180 + 14 * 60),
        aircraftIcao: "A359",
        segmentCabin: "J",
        fareClass: "Z",
      },
    ],
    cabins: {
      J: { seatsRemaining: 4, milesPerPax: 90000, surchargeUsdPerPax: 0, taxesUsdPerPax: 41, cppMicroAtObs: 1500 },
    },
    confidenceScore: 72,
    lastSeenMinutesAgo: 11,
  },

  // Cathay via HKG connection (multi-segment, mixed cabin)
  {
    programId: "CX_CATHAY",
    programName: "Cathay Asia Miles",
    segments: [
      {
        operatingAirlineIata: "CX",
        marketingAirlineIata: "CX",
        flightNumber: "841",
        originIata: "JFK",
        destIata: "HKG",
        departAt: departBase(240),
        arriveAt: departBase(240 + 16 * 60),
        aircraftIcao: "A35K",
        segmentCabin: "J",
        fareClass: "D",
      },
      {
        operatingAirlineIata: "CX",
        marketingAirlineIata: "CX",
        flightNumber: "548",
        originIata: "HKG",
        destIata: "NRT",
        departAt: departBase(240 + 19 * 60),
        arriveAt: departBase(240 + 23 * 60),
        aircraftIcao: "A333",
        segmentCabin: "J",
        fareClass: "D",
      },
    ],
    cabins: {
      J: { seatsRemaining: 2, milesPerPax: 90000, surchargeUsdPerPax: 285, taxesUsdPerPax: 102, cppMicroAtObs: 1400 },
      F: { seatsRemaining: 1, milesPerPax: 145000, surchargeUsdPerPax: 410, taxesUsdPerPax: 102, cppMicroAtObs: 1600 },
    },
    confidenceScore: 76,
    lastSeenMinutesAgo: 19,
  },

  // EVA via TPE connection (BR, all-four open)
  {
    programId: "AC_AEROPLAN",
    programName: "Aeroplan",
    segments: [
      {
        operatingAirlineIata: "BR",
        marketingAirlineIata: "AC",
        flightNumber: "5732",
        originIata: "JFK",
        destIata: "TPE",
        departAt: departBase(300),
        arriveAt: departBase(300 + 17 * 60),
        aircraftIcao: "B77W",
        segmentCabin: "J",
        fareClass: "I",
      },
      {
        operatingAirlineIata: "BR",
        marketingAirlineIata: "AC",
        flightNumber: "198",
        originIata: "TPE",
        destIata: "NRT",
        departAt: departBase(300 + 19 * 60),
        arriveAt: departBase(300 + 22 * 60),
        aircraftIcao: "B789",
        segmentCabin: "J",
        fareClass: "I",
      },
    ],
    cabins: {
      Y: { seatsRemaining: 9, milesPerPax: 50000, surchargeUsdPerPax: 0, taxesUsdPerPax: 88, cppMicroAtObs: 1500 },
      W: { seatsRemaining: 4, milesPerPax: 75000, surchargeUsdPerPax: 0, taxesUsdPerPax: 88, cppMicroAtObs: 1500 },
      J: { seatsRemaining: 2, milesPerPax: 87500, surchargeUsdPerPax: 0, taxesUsdPerPax: 88, cppMicroAtObs: 1500 },
      F: { seatsRemaining: 1, milesPerPax: 135000, surchargeUsdPerPax: 0, taxesUsdPerPax: 88, cppMicroAtObs: 1700 },
    },
    confidenceScore: 80,
    lastSeenMinutesAgo: 9,
  },

  // Turkish via IST connection (long routing)
  {
    programId: "TK_MILES_SMILES",
    programName: "Turkish Miles&Smiles",
    segments: [
      {
        operatingAirlineIata: "TK",
        marketingAirlineIata: "TK",
        flightNumber: "12",
        originIata: "JFK",
        destIata: "IST",
        departAt: departBase(360),
        arriveAt: departBase(360 + 10 * 60),
        aircraftIcao: "B77W",
        segmentCabin: "J",
        fareClass: "I",
      },
      {
        operatingAirlineIata: "TK",
        marketingAirlineIata: "TK",
        flightNumber: "198",
        originIata: "IST",
        destIata: "NRT",
        departAt: departBase(360 + 13 * 60),
        arriveAt: departBase(360 + 25 * 60),
        aircraftIcao: "B789",
        segmentCabin: "J",
        fareClass: "I",
      },
    ],
    cabins: {
      Y: { seatsRemaining: 9, milesPerPax: 47500, surchargeUsdPerPax: 0, taxesUsdPerPax: 76, cppMicroAtObs: 1300 },
      J: { seatsRemaining: 4, milesPerPax: 87500, surchargeUsdPerPax: 0, taxesUsdPerPax: 76, cppMicroAtObs: 1400 },
    },
    confidenceScore: 38,
    lastSeenMinutesAgo: 95,
  },

  // Flying Blue mixed cabin (W on transatlantic, J transpacific)
  {
    programId: "AF_FLYINGBLUE",
    programName: "Flying Blue",
    segments: [
      {
        operatingAirlineIata: "AF",
        marketingAirlineIata: "AF",
        flightNumber: "11",
        originIata: "JFK",
        destIata: "CDG",
        departAt: departBase(420),
        arriveAt: departBase(420 + 7 * 60),
        aircraftIcao: "B789",
        segmentCabin: "W",
        fareClass: "A",
      },
      {
        operatingAirlineIata: "AF",
        marketingAirlineIata: "AF",
        flightNumber: "276",
        originIata: "CDG",
        destIata: "NRT",
        departAt: departBase(420 + 10 * 60),
        arriveAt: departBase(420 + 22 * 60),
        aircraftIcao: "B77W",
        segmentCabin: "J",
        fareClass: "I",
      },
    ],
    cabins: {
      W: { seatsRemaining: 3, milesPerPax: 65000, surchargeUsdPerPax: 295, taxesUsdPerPax: 104, cppMicroAtObs: 1300 },
      J: { seatsRemaining: 2, milesPerPax: 100000, surchargeUsdPerPax: 380, taxesUsdPerPax: 104, cppMicroAtObs: 1300 },
    },
    confidenceScore: 67,
    lastSeenMinutesAgo: 27,
  },

  // Y-only Spirit-like (illustrates 1-cabin row)
  {
    programId: "UA_MP",
    programName: "United MileagePlus",
    segments: [
      {
        operatingAirlineIata: "WN",
        marketingAirlineIata: "UA",
        flightNumber: "8911",
        originIata: "JFK",
        destIata: "NRT",
        departAt: departBase(480),
        arriveAt: departBase(480 + 18 * 60),
        aircraftIcao: "B738",
        segmentCabin: "Y",
        fareClass: "X",
      },
    ],
    cabins: {
      Y: { seatsRemaining: 9, milesPerPax: 65000, surchargeUsdPerPax: 0, taxesUsdPerPax: 28, cppMicroAtObs: 1400 },
    },
    confidenceScore: 58,
    lastSeenMinutesAgo: 42,
  },

  // Stale-critical row (over 1h)
  {
    programId: "LH_MILES_MORE",
    programName: "Miles & More (partner-inferred)",
    segments: [
      {
        operatingAirlineIata: "LH",
        marketingAirlineIata: "LH",
        flightNumber: "401",
        originIata: "JFK",
        destIata: "FRA",
        departAt: departBase(540),
        arriveAt: departBase(540 + 7 * 60),
        aircraftIcao: "A359",
        segmentCabin: "F",
        fareClass: "A",
      },
      {
        operatingAirlineIata: "LH",
        marketingAirlineIata: "LH",
        flightNumber: "716",
        originIata: "FRA",
        destIata: "NRT",
        departAt: departBase(540 + 10 * 60),
        arriveAt: departBase(540 + 22 * 60),
        aircraftIcao: "B748",
        segmentCabin: "F",
        fareClass: "A",
      },
    ],
    cabins: {
      F: { seatsRemaining: 1, milesPerPax: 110000, surchargeUsdPerPax: 850, taxesUsdPerPax: 145, cppMicroAtObs: 1900 },
    },
    confidenceScore: 22,
    lastSeenMinutesAgo: 240,
  },
];

function buildRow(seed: MockSeed, _query: SearchQuery): SearchResultRow {
  const segments: ResultSegment[] = seed.segments.map((s, i) => ({
    ...s,
    segmentOrder: i + 1,
  }));
  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];
  const totalDurationMin = Math.round(
    (new Date(lastSeg.arriveAt).getTime() - new Date(firstSeg.departAt).getTime()) /
      60_000,
  );
  const cabinPrices: SearchResultRow["cabinPrices"] = {};
  for (const [c, p] of Object.entries(seed.cabins) as Array<
    [Cabin, Omit<CabinPrice, "cabin">]
  >) {
    cabinPrices[c] = { cabin: c, ...p };
  }
  const hash = itineraryHash({
    programId: seed.programId,
    pax: 1,
    departDate: firstSeg.departAt.slice(0, 10),
    segments,
  });
  return {
    id: hash.slice(0, 16),
    itineraryHash: hash,
    programId: seed.programId,
    programName: seed.programName,
    originIata: firstSeg.originIata,
    destIata: lastSeg.destIata,
    departDate: firstSeg.departAt,
    arriveDate: lastSeg.arriveAt,
    totalDurationMin,
    numSegments: segments.length,
    segments,
    cabinPrices,
    confidenceScore: seed.confidenceScore,
    observedAt: minutesAgo(seed.lastSeenMinutesAgo),
    lastSeenAt: minutesAgo(seed.lastSeenMinutesAgo),
    operatingFlightKey: operatingFlightKey(
      firstSeg.operatingAirlineIata,
      firstSeg.flightNumber,
      firstSeg.departAt,
    ),
  };
}

/** Group seeds by program for SSE per-program waves. Filters SEEDS so the
 * mock only fires when the query's origin/dest match the seed's first/last
 * segment. Other routes (e.g. HKG→LHR, LAX→CDG) cleanly fall through to
 * the chart-fallback path so the cockpit can still show estimates. */
export function groupedMockResults(query: SearchQuery) {
  const byProgram = new Map<string, SearchResultRow[]>();
  for (const seed of SEEDS) {
    const firstSeg = seed.segments[0];
    const lastSeg = seed.segments[seed.segments.length - 1];
    if (
      firstSeg.originIata !== query.origin ||
      lastSeg.destIata !== query.dest
    ) {
      continue;
    }
    const row = buildRow(seed, query);
    const list = byProgram.get(seed.programId) ?? [];
    list.push(row);
    byProgram.set(seed.programId, list);
  }
  return byProgram;
}

export function allMockResults(query: SearchQuery): SearchResultRow[] {
  return SEEDS.map((s) => buildRow(s, query));
}

export const MOCK_PROGRAMS_AT_LAUNCH = [
  "VS_FLYING_CLUB",
  "AS_MILEAGEPLAN",
  "BA_AVIOS",
  "AV_LIFEMILES",
  "AF_FLYINGBLUE",
  "UA_MP",
  "TK_MILES_SMILES",
  "NH_ANA",
  "AA_AADVANTAGE",
  "DL_SKYMILES",
  "CX_CATHAY",
  "AC_AEROPLAN",
  "LH_MILES_MORE",
] as const;
