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
  AM_CLUB_PREMIER: "https://www.aeromexico.com/",
  AD_AZUL_TUDOAZUL: "https://www.voeazul.com.br/",
  CM_CONNECTMILES: "https://www.copaair.com/",
  EK_SKYWARDS: "https://www.emirates.com/",
  ET_SHEBAMILES: "https://www.ethiopianairlines.com/",
  EY_GUEST: "https://www.etihad.com/",
  SK_EUROBONUS: "https://www.flysas.com/",
  AY_FINNAIR_PLUS: "https://www.finnair.com/",
  QF_FF: "https://www.qantas.com/",
  QR_PRIVILEGE: "https://www.qatarairways.com/",
  SV_ALFURSAN: "https://www.saudia.com/",
  SQ_KRISFLYER: "https://www.singaporeair.com/",
  G3_GOL_SMILES: "https://www.smiles.com.br/",
  VA_VELOCITY: "https://www.virginaustralia.com/",
};
export function bookingUrl(program: string, q: SearchQuery) {
  const base = BOOKING_SITES[program] ?? "https://www.alaskaair.com/";
  if (!q.origin || !q.dest || !q.departDate) return new URL(base).origin;
  if (program === "AS_MILEAGEPLAN")
    return `${base}?${new URLSearchParams({ O: q.origin, D: q.dest, OD: q.departDate, A: String(q.pax), C: "0", L: "0", RT: "false", ShoppingMethod: "onlineaward", awardType: "MilesOnly" })}`;
  if (program === "B6_TRUEBLUE")
    return `${base}?${new URLSearchParams({ from: q.origin, to: q.dest, depart: q.departDate, isMultiCity: "false", noOfRoute: "1", adults: String(q.pax), children: "0", infants: "0", usePoints: "true" })}`;
  if (program === "VS_FLYING_CLUB")
    return `${base}results/month?${new URLSearchParams({ origin: q.origin, destination: q.dest, month: q.departDate.slice(0, 7) })}`;
  return base;
}
