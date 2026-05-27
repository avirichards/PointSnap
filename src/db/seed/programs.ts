/**
 * 13 launch programs from HANDOFF.md.
 * fuelSurchargePassthrough: 0 = never passes YQ, 1 = sometimes, 2 = always.
 */
export const PROGRAMS = [
  { id: "UA_MP", sponsorAirlineIata: "UA", name: "United MileagePlus", pricingModel: "hybrid", fuelSurchargePassthrough: 0, expiryMonths: 18, notes: "Dynamic own-metal, chart partner. No YQ on award tickets." },
  { id: "AC_AEROPLAN", sponsorAirlineIata: "AC", name: "Air Canada Aeroplan", pricingModel: "hybrid", fuelSurchargePassthrough: 0, expiryMonths: 18, notes: "Distance-based, no YQ. Ship-day-1 with operational hygiene; active litigation vs Seats.aero." },
  { id: "AS_MILEAGEPLAN", sponsorAirlineIata: "AS", name: "Alaska Mileage Plan", pricingModel: "chart", fuelSurchargePassthrough: 0, expiryMonths: 24, notes: "Partner-only charts. No YQ. Famous for Cathay F sweet spots." },
  { id: "AA_AADVANTAGE", sponsorAirlineIata: "AA", name: "American AAdvantage", pricingModel: "hybrid", fuelSurchargePassthrough: 0, expiryMonths: 24, notes: "Dynamic own-metal, chart partner. Web Specials are off-chart." },
  { id: "DL_SKYMILES", sponsorAirlineIata: "DL", name: "Delta SkyMiles", pricingModel: "dynamic", fuelSurchargePassthrough: 0, expiryMonths: null, notes: "Pure dynamic pricing; no chart. Miles don't expire." },
  { id: "BA_AVIOS", sponsorAirlineIata: "BA", name: "British Airways Avios", pricingModel: "chart", fuelSurchargePassthrough: 2, expiryMonths: 36, notes: "Distance-based chart; brutal YQ on BA-operated." },
  { id: "AF_FLYINGBLUE", sponsorAirlineIata: "AF", name: "Air France/KLM Flying Blue", pricingModel: "hybrid", fuelSurchargePassthrough: 1, expiryMonths: 24, notes: "Dynamic + chart; Promo Rewards monthly. YQ varies by carrier." },
  { id: "LH_MILES_MORE", sponsorAirlineIata: "LH", name: "Lufthansa Miles & More", pricingModel: "hybrid", fuelSurchargePassthrough: 2, expiryMonths: 36, notes: "Partner-chart at launch (direct scraper deferred v1.1). Heavy YQ on LH/LX/OS. T-2 to T-4 partner F window." },
  { id: "NH_ANA", sponsorAirlineIata: "NH", name: "ANA Mileage Club", pricingModel: "chart", fuelSurchargePassthrough: 2, expiryMonths: 36, notes: "Famous round-trip Star chart. YQ on most non-US partners." },
  { id: "CX_CATHAY", sponsorAirlineIata: "CX", name: "Cathay Asia Miles", pricingModel: "chart", fuelSurchargePassthrough: 2, expiryMonths: 36, notes: "Zone-based, fuel surcharges critical (doubled Mar 2026)." },
  { id: "AV_LIFEMILES", sponsorAirlineIata: "AV", name: "Avianca LifeMiles", pricingModel: "chart", fuelSurchargePassthrough: 0, expiryMonths: 12, notes: "Star Alliance partner sweet spot; no YQ ever." },
  { id: "TK_MILES_SMILES", sponsorAirlineIata: "TK", name: "Turkish Miles&Smiles", pricingModel: "dynamic", fuelSurchargePassthrough: 1, expiryMonths: 36, notes: "Recently moved to per-segment dynamic. Phantom-availability prone." },
  { id: "VS_FLYING_CLUB", sponsorAirlineIata: "VS", name: "Virgin Atlantic Flying Club", pricingModel: "chart", fuelSurchargePassthrough: 2, expiryMonths: 18, notes: "Delta and ANA partner sweet spots. YQ on VS-operated and AF/KL." },
  { id: "B6_TRUEBLUE", sponsorAirlineIata: "B6", name: "JetBlue TrueBlue", pricingModel: "dynamic", fuelSurchargePassthrough: 0, expiryMonths: null, notes: "Revenue-based; points price tracks cash fare. No YQ, points don't expire. JetBlue-operated only." },
] as const;
