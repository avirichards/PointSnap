/** Independently reviewed US rules. Never use the legacy sample transfer seed for advice. */
export interface TransferRule {
  bank: string;
  program: string;
  ratio: number;
  minimum: number;
  increment: number;
  maximum?: number;
  rounding: "published" | "planning";
  feePerPoint?: number;
  feeCap?: number;
  checked: string;
  sources: string[];
  eligibility: string;
  timing: string;
}
const chase =
  "https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points";
const chaseRatio = "https://www.chase.com/sapphire-cards/personal/preferred";
const amex = "https://global.americanexpress.com/rewards/transfer";
const amexTerms =
  "https://www.americanexpress.com/content/dam/amex/us/rewards/membership-rewards/mr-terms-conditions-march-2026.pdf?tier=LF";
const capital =
  "https://www.capitalone.com/learn-grow/money-management/venture-miles-transfer-partnerships/";
const checked = "2026-09-06";
export const TRANSFER_RULES: TransferRule[] = [
  ...[
    "AC_AEROPLAN",
    "AF_FLYINGBLUE",
    "BA_AVIOS",
    "B6_TRUEBLUE",
    "SQ_KRISFLYER",
    "WN_RAPID_REWARDS",
    "UA_MP",
    "VS_FLYING_CLUB",
  ].map((program) => ({
    bank: "CHASE_UR",
    program,
    ratio: 1,
    minimum: 1000,
    increment: 1000,
    rounding: "published" as const,
    checked,
    sources: [chase, chaseRatio],
    eligibility:
      "Eligible US Chase card with partner transfers, such as Sapphire Preferred, Sapphire Reserve or Ink Business Preferred. Check the permitted recipient account in Chase.",
    timing: "May take up to 7 business days.",
  })),
  ...[
    "AC_AEROPLAN",
    "AF_FLYINGBLUE",
    "AV_LIFEMILES",
    "BA_AVIOS",
    "NH_ANA",
    "QR_PRIVILEGE",
    "SQ_KRISFLYER",
    "VS_FLYING_CLUB",
    "AM_CLUB_PREMIER",
    "CX_CATHAY",
    "EK_SKYWARDS",
    "DL_SKYMILES",
    "B6_TRUEBLUE",
    "QF_FF",
  ].map((program) => ({
    bank: "AMEX_MR",
    program,
    ratio:
      program === "AM_CLUB_PREMIER"
        ? 1.6
        : ["CX_CATHAY", "EK_SKYWARDS", "B6_TRUEBLUE"].includes(program)
          ? 0.8
          : 1,
    minimum: program === "B6_TRUEBLUE" ? 250 : program === "QF_FF" ? 500 : 1000,
    increment:
      program === "B6_TRUEBLUE" ? 50 : program === "QF_FF" ? 500 : 1000,
    rounding: (program === "VS_FLYING_CLUB" || program === "B6_TRUEBLUE"
      ? "published"
      : "planning") as TransferRule["rounding"],
    ...(program === "VS_FLYING_CLUB" ? { maximum: 999000 } : {}),
    ...(["DL_SKYMILES", "B6_TRUEBLUE"].includes(program)
      ? { feePerPoint: 0.0006, feeCap: 99 }
      : {}),
    checked,
    sources: [
      amex,
      amexTerms,
      ...(program === "VS_FLYING_CLUB"
        ? [
            "https://global.americanexpress.com/rewards/transfer?partner=5629f184e4b0b3d3bd79cc43",
          ]
        : []),
    ],
    eligibility:
      "Eligible US Membership Rewards card account and a linked loyalty account. Checking-only and some legacy products have restricted partners; confirm your card and recipient eligibility.",
    timing:
      program === "VS_FLYING_CLUB"
        ? "Published estimate: 48 hours; delays are possible."
        : "Timing varies by partner; confirm in American Express before proceeding.",
  })),
  ...[
    "AM_CLUB_PREMIER",
    "AC_AEROPLAN",
    "AV_LIFEMILES",
    "BA_AVIOS",
    "CX_CATHAY",
    "EY_GUEST",
    "AY_FINNAIR_PLUS",
    "AF_FLYINGBLUE",
    "QF_FF",
    "QR_PRIVILEGE",
    "SQ_KRISFLYER",
    "TK_MILES_SMILES",
    "EK_SKYWARDS",
    "B6_TRUEBLUE",
  ].map((program) => ({
    bank: "CAP1_VENTURE",
    program,
    ratio:
      program === "EK_SKYWARDS" ? 0.75 : program === "B6_TRUEBLUE" ? 0.6 : 1,
    minimum: 1000,
    increment: 1000,
    rounding: "planning" as const,
    checked,
    sources: [capital],
    eligibility:
      "Eligible US Capital One miles-earning account. The loyalty account name must match your Capital One account.",
    timing: "Transfer time varies; check Capital One for the selected partner.",
  })),
];
export function transferEstimate(
  rule: TransferRule,
  needed: number,
  airlineBalance: number,
  bankBalance: number,
  now = Date.now(),
) {
  if (
    [needed, airlineBalance, bankBalance].some(
      (n) => !Number.isSafeInteger(n) || n < 0,
    )
  )
    return null;
  if (now - Date.parse(rule.checked + "T00:00:00Z") > 30 * 86400000)
    return null;
  const missing = Math.max(0, needed - airlineBalance);
  const transfer = missing
    ? Math.max(
        rule.minimum,
        Math.ceil(missing / rule.ratio / rule.increment) * rule.increment,
      )
    : 0;
  const received = Math.floor(transfer * rule.ratio + 1e-8);
  return {
    missing,
    transfer,
    received,
    leftover: Math.max(0, airlineBalance + received - needed),
    shortfall: Math.max(0, transfer - bankBalance),
    overMaximum: rule.maximum !== undefined && transfer > rule.maximum,
    fee: rule.feePerPoint
      ? Math.min(transfer * rule.feePerPoint, rule.feeCap ?? Infinity)
      : null,
  };
}
