import type { FlightGroup } from "./comparison";
import { pointsForParty } from "./value";
/** Compare like currencies and cabins, never subtract unlike programs' points. */
export function flexibilityInsight(
  groups: FlightGroup[],
  requestedDate: string,
  pax: number,
  party: boolean,
) {
  const base = new Map<string, FlightGroup["offers"][number]>(),
    alternatives = new Map<string, FlightGroup["offers"][number]>();
  const amount = (offer: FlightGroup["offers"][number]) =>
    party ? pointsForParty(offer.price, pax) : offer.price.points;
  for (const group of groups)
    for (const offer of group.offers) {
      const key = `${offer.row.programId}:${offer.price.cabin}:${offer.price.eligibility?.label ?? "public"}:${offer.price.mixedCabin ? "mixed" : "single"}:${offer.price.cabinUnconfirmed ? "unknown" : "confirmed"}`;
      const map = offer.row.date === requestedDate ? base : alternatives;
      const prior = map.get(key);
      if (!prior || amount(offer) < amount(prior)) map.set(key, offer);
    }
  return (
    [...base.entries()]
      .flatMap(([key, offer]) => {
        const alternative = alternatives.get(key);
        return alternative && amount(alternative) < amount(offer)
          ? [
              {
                original: offer,
                alternative,
                saved: amount(offer) - amount(alternative),
              },
            ]
          : [];
      })
      .sort((a, b) => b.saved - a.saved)[0] ?? null
  );
}
