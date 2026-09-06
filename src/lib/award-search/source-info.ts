/** Public descriptions of verified adapter scope, never a claim of exhaustive airline coverage. */
export const SOURCE_INFO: Record<
  string,
  { inventory: "flights" | "calendar"; label: string; detail: string }
> = {
  CM_CONNECTMILES: {
    inventory: "flights",
    label: "Copa ConnectMiles & offered partner awards",
    detail:
      "Anonymous Copa searches with every returned matching Saver and Standard fare. Nearby-airport alternatives are counted separately from your exact airport search. Taxes and points are quoted per person; member availability and final cost may change after login. Connecting segment cabins and exact award seat counts remain unconfirmed. Requires the browser service. Broader route coverage remains under verification.",
  },
  SK_EUROBONUS: {
    inventory: "flights",
    label: "SAS EuroBonus award flights",
    detail:
      "Anonymous SAS searches with every returned Bonus and regular pay-with-points fare family. The flight list and fare choices are reconciled against the airline page. Taxes are quoted in EUR and shown per person. Segment cabins that cannot be confirmed remain marked unknown. SAS login is required to book, but not to search in PointSnap. Broader routes and hosted operation remain under verification.",
  },
  WN_RAPID_REWARDS: {
    inventory: "flights",
    label: "Southwest Rapid Rewards award flights",
    detail:
      "Anonymous Southwest points searches with all available fare families in the returned list. Basic, Choice, Choice Preferred and Choice Extra are Economy fares. Includes connections and stops without changing planes. Cash comparisons require the same flights and fare family. Taxes are quoted in USD; exact seat counts and refund conditions are not reported. Requires the browser service. Broader route coverage remains under verification.",
  },
  EY_GUEST: {
    inventory: "flights",
    label: "Etihad Guest & offered partner awards",
    detail:
      "Anonymous Etihad searches across Economy, Business and First, retaining available GuestSeat and pay-with-miles fare choices and exact taxes. Requires the browser service. A response that reaches the airline’s itinerary limit is reported as incomplete rather than silently truncated. Recheck fare rules and availability with Etihad before booking.",
  },
  AA_AADVANTAGE: {
    inventory: "flights",
    label: "American AAdvantage & offered partner awards",
    detail:
      "Anonymous American searches with all fares supplied in each returned itinerary list. The airline can expose different flight sets by cabin or route, so coverage is not exhaustive. Requires the browser service. Recheck the selected itinerary with American before booking.",
  },
  G3_GOL_SMILES: {
    inventory: "flights",
    label: "GOL Smiles & offered partner awards",
    detail:
      "Anonymous searches of Smiles's Brazilian site, with every displayed itinerary, regular-member miles and cash-and-miles choices, offered baggage bundles and travel fees paid in cash. Club and elite discounts are excluded. Fees are quoted in BRL. Requires the browser service.",
  },
  DL_SKYMILES: {
    inventory: "flights",
    label: "Delta SkyMiles award flights",
    detail:
      "A fresh anonymous Delta browser search, including every reported results page and available fare family. Personal cardholder discounts are not included. Requires the browser service; runtime or airline interruptions remain source errors.",
  },
  QF_FF: {
    inventory: "flights",
    label: "Qantas & offered partner rewards · cached",
    detail:
      "Cached Classic Reward itineraries on routes covered by Qantas's public finder, with source observation times. Australian domestic routes are not covered. Same-flight stops may be omitted. Recheck availability on Qantas before booking.",
  },
  ET_SHEBAMILES: {
    inventory: "flights",
    label: "Ethiopian ShebaMiles award flights",
    detail:
      "Individual itineraries and supplied Economy and Business awards, including connections and stops on the same flight. Cash fees are not reported by this search response.",
  },
  AS_MILEAGEPLAN: {
    inventory: "flights",
    label: "Alaska & offered partner awards",
    detail:
      "Individual itineraries and all supplied award fares, bookable with Alaska Atmos points.",
  },
  B6_TRUEBLUE: {
    inventory: "flights",
    label: "JetBlue & offered partner awards",
    detail:
      "Individual departures and supplied fares bookable with TrueBlue points, including offered United and Etihad partner flights. Exact-fare cash matches when available.",
  },
  VS_FLYING_CLUB: {
    inventory: "calendar",
    label: "Daily fare summary only",
    detail:
      "Daily cabin prices and seat counts; individual departures and exact fees are not reported.",
  },
  EK_SKYWARDS: {
    inventory: "flights",
    label: "easyJet & Jet2 partner flights only",
    detail:
      "easyJet and Jet2 flights bookable with Skywards miles. Emirates-operated flights are not connected.",
  },
  AM_CLUB_PREMIER: {
    inventory: "flights",
    label: "Aeromexico award flights",
    detail:
      "Individual itineraries and all supplied Classic and Dynamic fares, quoted in points plus Mexican pesos.",
  },
  F9_FRONTIER_MILES: {
    inventory: "flights",
    label: "US domestic award flights",
    detail:
      "Frontier award itineraries and fare bundles. International currency and premium seat types are not yet verified.",
  },
};

/** A native browser search must never inherit the public finder's cached scope. */
export function sourceInfo(programId: string, nativeBrowser = false) {
  if (programId === "QF_FF" && nativeBrowser)
    return {
      inventory: "flights" as const,
      label: "Qantas Classic & Classic Plus award flights",
      detail:
        "Anonymous native Qantas quotes, including offered partners and Australian domestic routes. Every returned itinerary and available reward fare is reconciled with the airline page. Exact points and fees are quoted per person, with mixed cabins preserved. Login is required to confirm eligibility and book. Broader inventory coverage remains under verification.",
    };
  return SOURCE_INFO[programId];
}
