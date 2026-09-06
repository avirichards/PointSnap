/** Public descriptions of verified adapter scope, never a claim of exhaustive airline coverage. */
export const SOURCE_INFO: Record<
  string,
  { inventory: "flights" | "calendar"; label: string; detail: string }
> = {
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
