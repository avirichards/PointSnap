/** Public descriptions of verified adapter scope, never a claim of exhaustive airline coverage. */
export const SOURCE_INFO: Record<
  string,
  { inventory: "flights" | "calendar"; label: string; detail: string }
> = {
  AS_MILEAGEPLAN: {
    inventory: "flights",
    label: "Alaska & offered partner awards",
    detail:
      "Individual itineraries and all supplied award fares, bookable with Alaska Atmos points.",
  },
  B6_TRUEBLUE: {
    inventory: "flights",
    label: "JetBlue award flights",
    detail:
      "Individual departures, connections and all supplied fare choices, with matching cash fares when available.",
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
