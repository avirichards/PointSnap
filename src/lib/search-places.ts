import { AIRPORTS } from "@/db/seed/airports";
/** Explicit metropolitan groups. Membership is always shown before selection. */
export const CITY_AIRPORTS = [
  {
    code: "NYC",
    city: "New York",
    countryIso2: "US",
    airports: ["JFK", "EWR", "LGA"],
  },
  {
    code: "LON",
    city: "London",
    countryIso2: "GB",
    airports: ["LHR", "LGW", "LCY", "LTN", "STN", "SEN"],
  },
  { code: "PAR", city: "Paris", countryIso2: "FR", airports: ["CDG", "ORY"] },
  { code: "TYO", city: "Tokyo", countryIso2: "JP", airports: ["HND", "NRT"] },
  { code: "CHI", city: "Chicago", countryIso2: "US", airports: ["ORD", "MDW"] },
  {
    code: "WAS",
    city: "Washington",
    countryIso2: "US",
    airports: ["IAD", "DCA", "BWI"],
  },
  { code: "YTO", city: "Toronto", countryIso2: "CA", airports: ["YYZ", "YTZ"] },
  { code: "OSA", city: "Osaka", countryIso2: "JP", airports: ["KIX", "ITM"] },
  { code: "SEL", city: "Seoul", countryIso2: "KR", airports: ["ICN", "GMP"] },
  {
    code: "BUE",
    city: "Buenos Aires",
    countryIso2: "AR",
    airports: ["EZE", "AEP"],
  },
] as const;
export function cityGroup(code: string) {
  return CITY_AIRPORTS.find((group) => group.code === code);
}
export function airportsForPlace(code: string): string[] {
  return [...(cityGroup(code)?.airports ?? [code])];
}
export function placeName(code: string): string {
  return (
    cityGroup(code)?.city ??
    AIRPORTS.find((airport) => airport.iata === code)?.city ??
    code
  );
}
export function airportPairs(
  origin: string,
  destination: string,
): { origin: string; destination: string }[] {
  return airportsForPlace(origin).flatMap((from) =>
    airportsForPlace(destination)
      .filter((to) => from !== to)
      .map((to) => ({ origin: from, destination: to })),
  );
}
export function physicalAirport(code: string) {
  return airportsForPlace(code)[0];
}
