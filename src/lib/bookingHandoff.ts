import type { SearchQuery } from "./types";
export const BOOKING_SITES: Record<string, string> = {
  AS_MILEAGEPLAN: "https://www.alaskaair.com/search/results",
  VS_FLYING_CLUB: "https://www.virginatlantic.com/reward-flight-finder/",
  B6_TRUEBLUE: "https://www.jetblue.com/booking/flights",
  AC_AEROPLAN: "https://www.aircanada.com/",
  AA_AADVANTAGE: "https://www.aa.com/booking/find-flights",
  AF_FLYINGBLUE: "https://www.airfrance.com/",
  BA_AVIOS: "https://www.britishairways.com/",
  AV_LIFEMILES: "https://www.lifemiles.com/",
  CX_CATHAY: "https://www.cathaypacific.com/",
  DL_SKYMILES: "https://www.delta.com/flight-search/book-a-flight",
  LH_MILES_MORE: "https://www.miles-and-more.com/",
  NH_ANA: "https://www.ana.co.jp/en/us/",
  TK_MILES_SMILES: "https://www.turkishairlines.com/",
  UA_MP: "https://www.united.com/en/us/book-flight/united-reservations",
  AM_CLUB_PREMIER: "https://www.aeromexico.com/bf/es-mx/reserva/opciones",
  AD_AZUL_TUDOAZUL: "https://www.voeazul.com.br/",
  CM_CONNECTMILES: "https://www.copaair.com/",
  EK_SKYWARDS: "https://www.emirates.com/",
  ET_SHEBAMILES: "https://www.ethiopianairlines.com/",
  EY_GUEST: "https://www.etihad.com/",
  SK_EUROBONUS: "https://www.flysas.com/",
  AY_FINNAIR_PLUS: "https://www.finnair.com/",
  QF_FF: "https://flightrewardfinder.qantas.com/",
  QR_PRIVILEGE: "https://www.qatarairways.com/",
  SV_ALFURSAN: "https://www.saudia.com/",
  SQ_KRISFLYER: "https://www.singaporeair.com/",
  G3_GOL_SMILES: "https://www.smiles.com.br/",
  VA_VELOCITY: "https://www.virginaustralia.com/",
  F9_FRONTIER_MILES: "https://booking.flyfrontier.com/Flight/InternalSelect",
};
export function skywardsPartnerUrl(q: SearchQuery) {
  const [year, month, day] = q.departDate.split("-");
  const params = new URLSearchParams({
    a: "flightsearch",
    filter_method: "relaxed",
    iataFrom: q.origin,
    iataTo: q.dest,
    outboundDate: `${month}/${day}/${year}`,
    returnDate: "",
    numPassengers: String(q.pax),
    searchByAge: "1",
    oneway: "1",
    sb3_selectbox_custom: "oneway",
  });
  for (let i = 0; i < q.pax; i++) params.append("passengerAge[]", "18");
  return `https://partnerrewards.emirates.com/search.php?${params}`;
}
export function bookingUrl(program: string, q: SearchQuery) {
  const base = BOOKING_SITES[program] ?? "https://www.alaskaair.com/";
  if (!q.origin || !q.dest || !q.departDate) return new URL(base).origin;
  if (program === "AS_MILEAGEPLAN")
    return `${base}?${new URLSearchParams({ O: q.origin, D: q.dest, OD: q.departDate, A: String(q.pax), C: "0", L: "0", RT: "false", ShoppingMethod: "onlineaward", awardType: "MilesOnly" })}`;
  if (program === "B6_TRUEBLUE")
    return `${base}?${new URLSearchParams({ from: q.origin, to: q.dest, depart: q.departDate, isMultiCity: "false", noOfRoute: "1", adults: String(q.pax), children: "0", infants: "0", usePoints: "true" })}`;
  if (program === "VS_FLYING_CLUB")
    return `${base}results/month?${new URLSearchParams({ origin: q.origin, destination: q.dest, month: q.departDate.slice(0, 7) })}`;
  if (program === "QF_FF")
    return `${base}?${new URLSearchParams({ o: q.origin, d: q.dest, dr: `${q.departDate}I${q.departDate}`, p: String(q.pax) })}`;
  if (program === "AM_CLUB_PREMIER")
    return `${base}?${new URLSearchParams({ itinerary: `${q.origin}_${q.dest}_${q.departDate}`, travelers: `A${q.pax}_C0_I0_PH0_PC0`, amrpoints: "true" })}`;
  if (program === "F9_FRONTIER_MILES") {
    const date = new Date(`${q.departDate}T12:00:00Z`);
    const month = date.toLocaleString("en-US", {
      month: "short",
      timeZone: "UTC",
    });
    return `${base}?${new URLSearchParams({ o1: q.origin, d1: q.dest, dd1: `${month} ${q.departDate.slice(8, 10)} ${q.departDate.slice(0, 4)}`, ADT: String(q.pax), loy: "true", promo: "", ftype: "Miles" })}`;
  }
  return base;
}
