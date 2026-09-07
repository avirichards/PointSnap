"use client";
import { useState } from "react";
import Link from "next/link";
import { rememberSearch } from "@/lib/search-history";
import { SiteHeader } from "@/components/layout/site-header";
import { ResultsSearchHeader } from "@/components/search/results-search-header";
import { AwardResults } from "@/components/search/award-results";
import type { AwardPrice, AwardResult } from "@/lib/award-search/types";
import type { SearchQuery } from "@/lib/types";
const fare = (
  id: string,
  cabin: "Y" | "J",
  points: number,
  cash: number,
  extras: Partial<AwardPrice> = {},
): AwardPrice => ({
  fareId: id,
  fareName: cabin === "J" ? "Business Standard" : "Economy Standard",
  cabin,
  points,
  cash,
  currency: "USD",
  seats: 2,
  mixedCabin: false,
  ...extras,
});
function example(
  id: string,
  flight: string,
  programId: string,
  prices: AwardPrice[],
  day = "2026-10-06",
  departure = "18:30",
  stop = false,
): AwardResult {
  return {
    id,
    programId,
    origin: "JFK",
    destination: "LHR",
    date: day,
    kind: "flight",
    duration: stop ? 670 : 430,
    source: "Design preview · example data",
    freshness: "cached",
    observedAt: "2026-09-06T12:00:00Z",
    bookingUrl: "#example-booking",
    prices: Object.fromEntries(prices.map((p) => [p.cabin, p])),
    fares: prices,
    segments: stop
      ? [
          {
            origin: "JFK",
            destination: "BOS",
            departure: `${day}T16:00:00`,
            arrival: `${day}T17:15:00`,
            airline: "B6",
            airlineName: "JetBlue",
            flightNumber: "B6188",
            aircraft: "Airbus A220",
            cabin: "Y",
          },
          {
            origin: "BOS",
            destination: "LHR",
            departure: `${day}T20:00:00`,
            arrival: `2026-10-07T08:10:00`,
            airline: "B6",
            airlineName: "JetBlue",
            flightNumber: "B61620",
            aircraft: "Airbus A321LR",
            cabin: "J",
          },
        ]
      : [
          {
            origin: "JFK",
            destination: "LHR",
            departure: `${day}T${departure}:00`,
            arrival: `${day.slice(0, 8)}${String(Number(day.slice(8)) + 1).padStart(2, "0")}T06:40:00`,
            airline: "BA",
            airlineName: "British Airways",
            flightNumber: flight,
            aircraft: "Boeing 777-300ER",
            cabin: "J",
          },
        ],
  };
}
const rows = [
  example("preview-a", "BA178", "AS_MILEAGEPLAN", [
    fare("a-y", "Y", 22500, 38.1),
    fare("a-j", "J", 55000, 198.2),
    fare("a-j-flex", "J", 70000, 125, {
      fareName: "Business Flexible",
      refundable: true,
    }),
  ]),
  example("preview-b", "BA178", "BA_AVIOS", [
    fare("b-y", "Y", 25000, 155),
    fare("b-j", "J", 65000, 280, {
      cashFare: {
        amount: 2400,
        currency: "USD",
        fareName: "Business cash example",
        refundable: false,
        observedAt: "2026-09-06T12:00:00Z",
        bookingUrl: "#example-cash",
      },
    }),
  ]),
  example(
    "preview-c",
    "BA116",
    "BA_AVIOS",
    [fare("c-y", "Y", 20000, 150), fare("c-j", "J", 75000, 295)],
    "2026-10-07",
    "20:00",
  ),
  example(
    "preview-d",
    "B61620",
    "B6_TRUEBLUE",
    [
      fare("d-j", "J", 64000, 5.6, {
        mixedCabin: true,
        segmentCabins: ["Y", "J"],
      }),
    ],
    "2026-10-06",
    "16:00",
    true,
  ),
];
export function ProductPreview() {
  const [query, setQuery] = useState<SearchQuery>({
    origin: "JFK",
    dest: "LHR",
    departDate: "2026-10-06",
    pax: 1,
    minCabin: "Y",
    flexDays: 1,
  });
  const [state, setState] = useState("results");
  return (
    <>
      <SiteHeader />
      <main id="main" className="search-workspace award-workspace has-results">
        <div className="preview-notice">
          <strong>Design preview</strong>
          <span>
            Example prices and flights for interaction testing. These are not
            bookable availability.
          </span>
          <select
            aria-label="Preview state"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="results">Results</option>
            <option value="loading">Loading</option>
            <option value="empty">No results</option>
            <option value="error">Partial coverage</option>
          </select>
          <Link
            className="underline text-sm"
            href="/sweet-spots"
            onClick={() =>
              rememberSearch(
                "origin=JFK&dest=LHR&departDate=2026-10-06&pax=1",
                rows,
              )
            }
          >
            Try examples in Explore
          </Link>
        </div>
        <ResultsSearchHeader
          key={JSON.stringify(query)}
          query={query}
          onSearch={setQuery}
        />
        {state === "error" && (
          <p role="status" className="rounded-xl border p-4">
            Some sources could not finish. The returned flights below remain
            available.
          </p>
        )}
        <AwardResults
          key={state}
          rows={state === "empty" || state === "loading" ? [] : rows}
          pax={query.pax}
          minCabin="Y"
          requestedDate="2026-10-06"
          loading={state === "loading"}
          coverage={[]}
          dates={["2026-10-05", "2026-10-06", "2026-10-07"]}
          dayStatus={["2026-10-05", "2026-10-06", "2026-10-07"].map((date) => ({
            date,
            state:
              state === "error"
                ? "error"
                : state === "loading"
                  ? "searching"
                  : "complete",
          }))}
        />
      </main>
    </>
  );
}
