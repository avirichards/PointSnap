export const TRANSFERABLE_CURRENCIES = [
  { id: "CHASE_UR", name: "Chase Ultimate Rewards", issuer: "Chase" },
  { id: "AMEX_MR", name: "American Express Membership Rewards", issuer: "American Express" },
  { id: "CAP1_VENTURE", name: "Capital One Venture Miles", issuer: "Capital One" },
  { id: "CITI_TY", name: "Citi ThankYou Points", issuer: "Citi" },
  { id: "BILT", name: "Bilt Rewards", issuer: "Bilt" },
  { id: "MARRIOTT_BONVOY", name: "Marriott Bonvoy", issuer: "Marriott" },
  { id: "WELLS_FARGO", name: "Wells Fargo Rewards", issuer: "Wells Fargo" },
] as const;

/**
 * Each row: (currency, program, ratio_micro). Default ratio is 1:1 (1000).
 * Marriott->airline is 3:1 in practice (333), often with a 5K bonus per 60K.
 * Capital One transfers most at 1:1; some partners at 1:0.5 (5:1).
 */
export const TRANSFER_RATIOS: Array<{
  currencyId: string;
  programId: string;
  ratioMicro: number;
  minTransfer?: number;
  increment?: number;
}> = [
  // Chase UR
  { currencyId: "CHASE_UR", programId: "UA_MP", ratioMicro: 1000 },
  { currencyId: "CHASE_UR", programId: "AC_AEROPLAN", ratioMicro: 1000 },
  { currencyId: "CHASE_UR", programId: "AF_FLYINGBLUE", ratioMicro: 1000 },
  { currencyId: "CHASE_UR", programId: "BA_AVIOS", ratioMicro: 1000 },
  { currencyId: "CHASE_UR", programId: "VS_FLYING_CLUB", ratioMicro: 1000 },

  // Amex MR
  { currencyId: "AMEX_MR", programId: "AC_AEROPLAN", ratioMicro: 1000 },
  { currencyId: "AMEX_MR", programId: "NH_ANA", ratioMicro: 1000 },
  { currencyId: "AMEX_MR", programId: "AS_MILEAGEPLAN", ratioMicro: 1000, minTransfer: 1000, increment: 1000 },
  { currencyId: "AMEX_MR", programId: "BA_AVIOS", ratioMicro: 1000 },
  { currencyId: "AMEX_MR", programId: "AF_FLYINGBLUE", ratioMicro: 1000 },
  { currencyId: "AMEX_MR", programId: "DL_SKYMILES", ratioMicro: 1000 },
  { currencyId: "AMEX_MR", programId: "VS_FLYING_CLUB", ratioMicro: 1000 },
  { currencyId: "AMEX_MR", programId: "AV_LIFEMILES", ratioMicro: 1000 },
  { currencyId: "AMEX_MR", programId: "CX_CATHAY", ratioMicro: 1000 },

  // Capital One Venture (1:1 to most, 1:0.5 to a few)
  { currencyId: "CAP1_VENTURE", programId: "AC_AEROPLAN", ratioMicro: 1000 },
  { currencyId: "CAP1_VENTURE", programId: "AF_FLYINGBLUE", ratioMicro: 1000 },
  { currencyId: "CAP1_VENTURE", programId: "AV_LIFEMILES", ratioMicro: 1000 },
  { currencyId: "CAP1_VENTURE", programId: "BA_AVIOS", ratioMicro: 1000 },
  { currencyId: "CAP1_VENTURE", programId: "TK_MILES_SMILES", ratioMicro: 1000 },
  { currencyId: "CAP1_VENTURE", programId: "VS_FLYING_CLUB", ratioMicro: 1000 },
  { currencyId: "CAP1_VENTURE", programId: "CX_CATHAY", ratioMicro: 1000 },

  // Citi TY
  { currencyId: "CITI_TY", programId: "AF_FLYINGBLUE", ratioMicro: 1000 },
  { currencyId: "CITI_TY", programId: "AV_LIFEMILES", ratioMicro: 1000 },
  { currencyId: "CITI_TY", programId: "TK_MILES_SMILES", ratioMicro: 1000 },
  { currencyId: "CITI_TY", programId: "VS_FLYING_CLUB", ratioMicro: 1000 },
  { currencyId: "CITI_TY", programId: "CX_CATHAY", ratioMicro: 1000 },

  // Bilt
  { currencyId: "BILT", programId: "AC_AEROPLAN", ratioMicro: 1000 },
  { currencyId: "BILT", programId: "AA_AADVANTAGE", ratioMicro: 1000 },
  { currencyId: "BILT", programId: "AF_FLYINGBLUE", ratioMicro: 1000 },
  { currencyId: "BILT", programId: "BA_AVIOS", ratioMicro: 1000 },
  { currencyId: "BILT", programId: "VS_FLYING_CLUB", ratioMicro: 1000 },
  { currencyId: "BILT", programId: "TK_MILES_SMILES", ratioMicro: 1000 },
  { currencyId: "BILT", programId: "CX_CATHAY", ratioMicro: 1000 },

  // Marriott Bonvoy 3:1 to airlines
  { currencyId: "MARRIOTT_BONVOY", programId: "UA_MP", ratioMicro: 333 },
  { currencyId: "MARRIOTT_BONVOY", programId: "AC_AEROPLAN", ratioMicro: 333 },
  { currencyId: "MARRIOTT_BONVOY", programId: "AS_MILEAGEPLAN", ratioMicro: 333 },
  { currencyId: "MARRIOTT_BONVOY", programId: "AA_AADVANTAGE", ratioMicro: 333 },
  { currencyId: "MARRIOTT_BONVOY", programId: "DL_SKYMILES", ratioMicro: 333 },
  { currencyId: "MARRIOTT_BONVOY", programId: "BA_AVIOS", ratioMicro: 333 },
  { currencyId: "MARRIOTT_BONVOY", programId: "AF_FLYINGBLUE", ratioMicro: 333 },
  { currencyId: "MARRIOTT_BONVOY", programId: "LH_MILES_MORE", ratioMicro: 333 },
  { currencyId: "MARRIOTT_BONVOY", programId: "NH_ANA", ratioMicro: 333 },
  { currencyId: "MARRIOTT_BONVOY", programId: "CX_CATHAY", ratioMicro: 333 },
  { currencyId: "MARRIOTT_BONVOY", programId: "VS_FLYING_CLUB", ratioMicro: 333 },

  // Wells Fargo Rewards 1:1 to a subset
  { currencyId: "WELLS_FARGO", programId: "AC_AEROPLAN", ratioMicro: 1000 },
  { currencyId: "WELLS_FARGO", programId: "AF_FLYINGBLUE", ratioMicro: 1000 },
  { currencyId: "WELLS_FARGO", programId: "BA_AVIOS", ratioMicro: 1000 },
  { currencyId: "WELLS_FARGO", programId: "AV_LIFEMILES", ratioMicro: 1000 },
];

/** Active May 2026 bonuses — example seed; ops team refreshes monthly. */
export const TRANSFER_BONUSES: Array<{
  currencyId: string;
  programId: string;
  bonusPct: number;
  startsAt: string;
  endsAt: string;
  sourceUrl?: string;
}> = [
  {
    currencyId: "AMEX_MR",
    programId: "NH_ANA",
    bonusPct: 30,
    startsAt: "2026-05-01T00:00:00Z",
    endsAt: "2026-05-31T23:59:59Z",
    sourceUrl: "https://www.americanexpress.com/transfer/ana",
  },
  {
    currencyId: "CHASE_UR",
    programId: "AC_AEROPLAN",
    bonusPct: 15,
    startsAt: "2026-05-10T00:00:00Z",
    endsAt: "2026-06-15T23:59:59Z",
    sourceUrl: "https://www.chase.com/transfer-bonus",
  },
  {
    currencyId: "CITI_TY",
    programId: "AV_LIFEMILES",
    bonusPct: 25,
    startsAt: "2026-05-05T00:00:00Z",
    endsAt: "2026-05-25T23:59:59Z",
  },
];

/** Internal cpp valuations (cents per point * 1000). */
export const VALUATIONS: Array<{
  programId?: string;
  currencyId?: string;
  cppMicro: number;
  source: string;
  effectiveFrom: string;
}> = [
  // Programs
  { programId: "UA_MP", cppMicro: 1400, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "AC_AEROPLAN", cppMicro: 1500, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "AS_MILEAGEPLAN", cppMicro: 1800, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "AA_AADVANTAGE", cppMicro: 1500, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "DL_SKYMILES", cppMicro: 1200, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "BA_AVIOS", cppMicro: 1500, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "AF_FLYINGBLUE", cppMicro: 1300, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "LH_MILES_MORE", cppMicro: 1900, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "NH_ANA", cppMicro: 1700, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "CX_CATHAY", cppMicro: 1500, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "AV_LIFEMILES", cppMicro: 1300, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "TK_MILES_SMILES", cppMicro: 1400, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { programId: "VS_FLYING_CLUB", cppMicro: 1500, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  // Currencies
  { currencyId: "CHASE_UR", cppMicro: 2050, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { currencyId: "AMEX_MR", cppMicro: 2000, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { currencyId: "CAP1_VENTURE", cppMicro: 1850, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { currencyId: "CITI_TY", cppMicro: 1800, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { currencyId: "BILT", cppMicro: 2100, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { currencyId: "MARRIOTT_BONVOY", cppMicro: 700, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
  { currencyId: "WELLS_FARGO", cppMicro: 1300, source: "INTERNAL_2026Q2", effectiveFrom: "2026-04-01T00:00:00Z" },
];
