"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { searchHistory } from "@/lib/search-history";
import { observedFlightGroups } from "@/lib/search-observations";
import { localCalendarDay } from "@/lib/calendar";
import { CABIN_LABEL, CABIN_ORDER, type Cabin } from "@/lib/types";
import { placeName } from "@/lib/search-places";
import { queryParams } from "@/lib/award-search/query";
import {
  DisplayCurrencyProvider,
  Money,
} from "@/components/search/display-currency";
import { programName } from "@/lib/programs";
import { Button } from "@/components/ui/button";
export function ExploreWorkspace() {
  return (
    <DisplayCurrencyProvider>
      <Explore />
    </DisplayCurrencyProvider>
  );
}
function Explore() {
  const history = useSyncExternalStore(
    searchHistory.subscribe,
    searchHistory.read,
    searchHistory.server,
  );
  const [cabin, setCabin] = useState<Cabin | "all">("all"),
    [origin, setOrigin] = useState("all");
  const groups = useMemo(() => observedFlightGroups(history), [history]);
  const origins = [...new Set(groups.map((g) => g.row.origin))];
  const options = groups
    .filter(
      (g) =>
        (origin === "all" || origin === g.row.origin) &&
        g.row.date >= localCalendarDay(),
    )
    .flatMap((g) => {
      const offer = g.offers
        .filter((o) => cabin === "all" || o.price.cabin === cabin)
        .sort((a, b) => a.price.points - b.price.points)[0];
      return offer ? [{ group: g, offer }] : [];
    })
    .sort((a, b) => a.offer.price.points - b.offer.price.points);
  return (
    <div className="product-page">
      <header className="page-intro">
        <div>
          <p className="eyebrow">A LITTLE MORE POSSIBILITY</p>
          <h1>Where could your points take you?</h1>
          <p>
            Revisit the flights found in your searches. Change a date, a cabin,
            or your destination.
          </p>
        </div>
      </header>
      {history.length > 0 ? (
        <>
          <div className="explore-controls">
            <label className="trip-label">
              Departing from
              <select
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
              >
                <option value="all">Every searched airport</option>
                {origins.map((o) => (
                  <option key={o} value={o}>
                    {placeName(o)} · {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="trip-label">
              Cabin
              <select
                value={cabin}
                onChange={(e) => setCabin(e.target.value as Cabin | "all")}
              >
                <option value="all">Any cabin</option>
                {CABIN_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CABIN_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-sm text-muted-foreground my-6">
            Observations from your last {history.length} search
            {history.length === 1 ? "" : "es"} in this session. Prices are per
            person and may have changed. Fewer points across different programs
            does not necessarily mean better value.
          </p>
          <div className="trip-flight-grid">
            {options.slice(0, 60).map(({ group: g, offer }) => (
              <article key={g.id} className="explore-option">
                <p className="eyebrow">
                  {g.row.origin} → {g.row.destination}
                </p>
                <h2>{placeName(g.row.destination)}</h2>
                <p className="text-sm text-muted-foreground mt-2">
                  {g.row.date} · {CABIN_LABEL[offer.price.cabin]}
                  {offer.price.mixedCabin ? " · Mixed cabin" : ""}
                  <span className="block mt-1">
                    Quoted for {offer.price.quotedPassengers} traveler
                    {offer.price.quotedPassengers === 1 ? "" : "s"}
                  </span>
                </p>
                <div className="saved-price">
                  <strong>
                    {offer.price.points.toLocaleString()} <small>points</small>
                  </strong>
                  <span>
                    + <Money price={offer.price} />
                  </span>
                  <small>{programName(offer.row.programId)}</small>
                </div>
                {offer.price.eligibility && (
                  <p className="text-xs mt-3 text-amber-700 dark:text-amber-300">
                    {offer.price.eligibility.label}
                  </p>
                )}
                <p className="text-xs text-muted-foreground my-4">
                  {g.row.segments.map((s) => s.flightNumber).join(" · ")}
                  <br />
                  {offer.row.source} · Observed{" "}
                  {new Date(offer.row.observedAt).toLocaleString()}
                </p>
                <Button asChild variant="outline" className="w-full">
                  <Link
                    href={`/search?${queryParams({ origin: g.row.origin, dest: g.row.destination, departDate: g.row.date, pax: offer.price.quotedPassengers ?? 1, minCabin: offer.price.cabin })}`}
                  >
                    Search this option <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </article>
            ))}
          </div>
          {!options.length && (
            <div className="product-empty">
              <h2>No observed flights match.</h2>
              <p>Try another cabin or run a fresh search.</p>
            </div>
          )}
          {options.length > 60 && (
            <p className="text-sm text-muted-foreground mt-5">
              Showing 60 ideas. Every fare remains in its original search.
            </p>
          )}
        </>
      ) : (
        <div className="product-empty">
          <div className="empty-emblem">
            <Compass />
          </div>
          <h2>Start with somewhere you’d love to go.</h2>
          <p>
            After a search, the flights returned will appear here. You’ll be
            exploring actual observations, with their dates and booking
            programs.
          </p>
          <Button asChild>
            <Link href="/search">
              Explore a route <ArrowRight />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
