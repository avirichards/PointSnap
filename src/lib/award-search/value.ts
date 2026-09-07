import type { AwardPrice } from "./types";

export function pointsForParty(price: AwardPrice, passengers: number) {
  return price.quotedPassengers === passengers &&
    price.partyPoints !== undefined
    ? price.partyPoints
    : price.points * passengers;
}

/** USD cents saved per point, after the award's taxes and fees. */
export function centsPerPoint(price?: AwardPrice): number | null {
  if (
    !price?.cashFare ||
    price.mixedCabin ||
    price.cabinUnconfirmed ||
    price.currency !== "USD" ||
    price.cashFare.currency !== "USD" ||
    price.cash === null ||
    !Number.isFinite(price.points) ||
    price.points <= 0 ||
    !Number.isFinite(price.cash) ||
    price.cash < 0 ||
    !Number.isFinite(price.cashFare.amount) ||
    price.cashFare.amount < 0
  )
    return null;
  return ((price.cashFare.amount - price.cash) / price.points) * 100;
}
