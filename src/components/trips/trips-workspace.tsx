"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  ArrowUpRight,
  ArrowRight,
  X,
  Pencil,
  Check,
  Plane,
} from "lucide-react";
import { useTrips } from "@/hooks/use-trips";
import { Button } from "@/components/ui/button";
import {
  DisplayCurrencyProvider,
  DisplayPreferences,
  Money,
} from "@/components/search/display-currency";
import { useTimeFormat } from "@/components/search/time-preference";
import { programName } from "@/lib/programs";
import { CABIN_LABEL } from "@/lib/types";
import { placeName } from "@/lib/search-places";
import type { TripFlight } from "@/lib/trips";
import { queryParams } from "@/lib/award-search/query";
const num = (n: number) => new Intl.NumberFormat("en-US").format(n);
export function TripsWorkspace() {
  return (
    <DisplayCurrencyProvider>
      <Trips />
    </DisplayCurrencyProvider>
  );
}
function Trips() {
  const { data, ready, error: loadError, act, refresh } = useTrips();
  const [selected, setSelected] = useState<string[]>([]),
    [message, setMessage] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false);
  const comparisons = data.flights.filter((f) => selected.includes(f.id));
  async function remove(id: string, trip = false) {
    setMessage("");
    try {
      await act(
        trip ? { action: "removeTrip", id } : { action: "removeFlight", id },
      );
      setSelected((old) => old.filter((i) => i !== id));
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not remove this item.",
      );
    }
  }
  return (
    <div className="product-page">
      <header className="page-intro">
        <div>
          <p className="eyebrow">THE POSSIBILITIES YOU KEPT</p>
          <h1>My trips</h1>
          <p>
            Keep your best options together. Compare them when you’re ready.
          </p>
        </div>
        <DisplayPreferences />
      </header>
      {!data.owner && (
        <div className="session-notice">
          <Bookmark className="size-5 shrink-0" />
          <div>
            <strong>Your session shortlist</strong>
            <p>
              These options stay in this open session and clear on reload. Sign
              in before saving to keep trips across devices.
            </p>
          </div>
          <Link href="/sign-in?next=/trips">
            Sign in <ArrowRight className="size-4" />
          </Link>
        </div>
      )}
      {loadError && (
        <div role="alert" className="session-notice">
          <p>{loadError}</p>
          <Button variant="outline" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-destructive">
          {message}
        </p>
      )}
      {comparisons.length > 0 && (
        <a className="compare-shortcut" href="#compare-heading">
          Compare {comparisons.length} selected option
          {comparisons.length > 1 ? "s" : ""} <ArrowRight className="size-4" />
        </a>
      )}
      {!ready ? (
        <p role="status" className="p-10 text-muted-foreground">
          Loading your trips…
        </p>
      ) : !data.trips.length ? (
        <div className="product-empty">
          <div className="empty-emblem">
            <Plane />
          </div>
          <h2>Your next trip starts with a possibility.</h2>
          <p>
            Search for a flight, choose a fare, then use “Save to trip.” You can
            keep outbound, return and alternate options together.
          </p>
          <Button asChild>
            <Link href="/search">
              Find a flight <ArrowRight />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-8 mt-8">
          {data.trips.map((trip) => (
            <section key={trip.id} className="trip-section">
              <div className="trip-heading">
                {editing === trip.id ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      try {
                        await act({ action: "rename", tripId: trip.id, name });
                        setEditing(null);
                      } catch (e) {
                        setMessage(
                          e instanceof Error ? e.message : "Could not rename.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <input
                      aria-label="Trip name"
                      value={name}
                      maxLength={80}
                      required
                      onChange={(e) => setName(e.target.value)}
                    />
                    <Button
                      variant="ghost"
                      disabled={busy}
                      aria-label="Save trip name"
                    >
                      <Check />
                    </Button>
                  </form>
                ) : (
                  <h2>{trip.name}</h2>
                )}
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    aria-label={`Rename ${trip.name}`}
                    onClick={() => {
                      setEditing(trip.id);
                      setName(trip.name);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {data.flights.every((f) => f.trip_id !== trip.id) && (
                    <Button
                      variant="ghost"
                      onClick={() => void remove(trip.id, true)}
                    >
                      Remove empty trip
                    </Button>
                  )}
                </div>
              </div>
              <div className="trip-flight-grid">
                {data.flights
                  .filter((f) => f.trip_id === trip.id)
                  .map((f) => (
                    <SavedOption
                      key={f.id}
                      flight={f}
                      checked={selected.includes(f.id)}
                      onCompare={() => {
                        setMessage("");
                        if (selected.includes(f.id))
                          setSelected(selected.filter((id) => id !== f.id));
                        else if (selected.length < 4)
                          setSelected([...selected, f.id]);
                        else
                          setMessage(
                            "You can compare up to four options. Remove one to add another.",
                          );
                      }}
                      onRemove={() => void remove(f.id)}
                    />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {comparisons.length > 0 && (
        <section
          className="comparison-section"
          aria-labelledby="compare-heading"
        >
          <div className="trip-heading">
            <div>
              <p className="eyebrow">SIDE BY SIDE</p>
              <h2 id="compare-heading">
                Compare {comparisons.length} option
                {comparisons.length > 1 ? "s" : ""}
              </h2>
            </div>
            <Button variant="ghost" onClick={() => setSelected([])}>
              Clear comparison <X className="size-4" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Points and fees below are for each saved party. Different programs
            have different point values. Saved prices need a fresh search before
            booking.
          </p>
          <div className="overflow-x-auto">
            <table className="trip-compare">
              <thead>
                <tr>
                  <th>Compare</th>
                  {comparisons.map((f) => (
                    <th key={f.id}>
                      {f.snapshot.origin} → {f.snapshot.destination}
                      <small>
                        {f.snapshot.date} · {f.leg}
                      </small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Book with",
                    (f: TripFlight) => programName(f.snapshot.programId),
                  ],
                  ["Travelers", (f: TripFlight) => f.snapshot.pax],
                  [
                    "Points for party",
                    (f: TripFlight) => num(f.snapshot.partyPoints),
                  ],
                  [
                    "Fees for party",
                    (f: TripFlight) => (
                      <Money
                        price={f.snapshot.price}
                        multiplier={f.snapshot.pax}
                        original
                      />
                    ),
                  ],
                  [
                    "Cabin",
                    (f: TripFlight) =>
                      `${CABIN_LABEL[f.snapshot.price.cabin]}${f.snapshot.price.mixedCabin ? " · Mixed cabin" : ""}${f.snapshot.price.cabinUnconfirmed ? " · Unconfirmed" : ""}`,
                  ],
                  [
                    "Journey",
                    (f: TripFlight) =>
                      f.snapshot.duration === null
                        ? "Not reported"
                        : `${Math.floor(f.snapshot.duration / 60)}h ${f.snapshot.duration % 60}m`,
                  ],
                  [
                    "Connections",
                    (f: TripFlight) => f.snapshot.segments.length - 1,
                  ],
                  [
                    "Fare",
                    (f: TripFlight) =>
                      f.snapshot.price.fareName ?? "Not reported",
                  ],
                  [
                    "Refundable",
                    (f: TripFlight) =>
                      f.snapshot.price.refundable === null
                        ? "Not reported"
                        : f.snapshot.price.refundable
                          ? "Yes · check airline rules"
                          : "No",
                  ],
                  [
                    "Eligibility",
                    (f: TripFlight) =>
                      f.snapshot.price.eligibility?.label ??
                      "No special eligibility reported",
                  ],
                ].map(([label, render]) => (
                  <tr key={label as string}>
                    <th scope="row">{label as string}</th>
                    {comparisons.map((f) => (
                      <td key={f.id}>
                        {(render as (f: TripFlight) => React.ReactNode)(f)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
function SavedOption({
  flight,
  checked,
  onCompare,
  onRemove,
}: {
  flight: TripFlight;
  checked: boolean;
  onCompare: () => void;
  onRemove: () => void;
}) {
  const s = flight.snapshot;
  const { time } = useTimeFormat();
  return (
    <article className={`saved-option ${checked ? "is-selected" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="saved-leg">{flight.leg} option</span>
        <button
          className="icon-button"
          onClick={onRemove}
          aria-label={`Remove ${s.origin} to ${s.destination} on ${s.date}`}
        >
          <X className="size-4" />
        </button>
      </div>
      <h3>
        {placeName(s.origin)} <ArrowRight className="size-4" />{" "}
        {placeName(s.destination)}
      </h3>
      <p className="text-sm text-muted-foreground">
        {s.date} · {s.pax} traveler{s.pax > 1 ? "s" : ""} ·{" "}
        {CABIN_LABEL[s.price.cabin]}
      </p>
      <p className="my-4 font-medium">
        {time(s.segments[0].departure)} →{" "}
        {time(s.segments.at(-1)?.arrival ?? null)}
      </p>
      <p className="text-sm">
        {s.segments.map((segment) => segment.flightNumber).join(" · ")}
      </p>
      <div className="saved-price">
        <strong>
          {num(s.partyPoints)} <small>points</small>
        </strong>
        <span>
          + <Money price={s.price} multiplier={s.pax} />
        </span>
        <small>
          For {s.pax} · {programName(s.programId)}
        </small>
      </div>
      {s.price.mixedCabin && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Mixed cabin · check each segment
        </p>
      )}
      {s.price.eligibility && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {s.price.eligibility.label}
        </p>
      )}
      <p className="text-xs text-muted-foreground my-4">
        {s.source} · observed {new Date(s.observedAt).toLocaleString()}. Prices
        may have changed.
      </p>
      <div className="flex items-center justify-between gap-3">
        <label className="flex gap-2 items-center text-sm min-h-11">
          <input
            type="checkbox"
            checked={checked}
            onChange={onCompare}
            aria-label={`Compare ${programName(s.programId)} ${s.origin} to ${s.destination} on ${s.date}`}
          />
          Compare
        </label>
        <Button asChild variant="outline">
          <Link
            href={`/search?${queryParams({ origin: s.origin, dest: s.destination, departDate: s.date, pax: s.pax, minCabin: s.price.cabin })}`}
          >
            Check again <ArrowUpRight className="size-4" />
          </Link>
        </Button>
      </div>
    </article>
  );
}
