"use client";
import { useState } from "react";
import Link from "next/link";
import { Bookmark, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTrips } from "@/hooks/use-trips";
import { flightSnapshot, type TripLeg } from "@/lib/trips";
import type { AwardResult, AwardPrice } from "@/lib/award-search/types";
import { placeName } from "@/lib/search-places";
export function SaveFlight({
  row,
  price,
  pax,
}: {
  row: AwardResult;
  price: AwardPrice;
  pax: number;
}) {
  const { data, act, ready, error: loadError } = useTrips();
  const [open, setOpen] = useState(false),
    [tripId, setTrip] = useState(""),
    [name, setName] = useState(
      `${placeName(row.destination)} · ${row.date.slice(0, 7)}`,
    ),
    [leg, setLeg] = useState<TripLeg>("outbound"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <div className="save-flight">

        <Button
          variant="outline"
          className="w-full h-11"
          aria-expanded={open}
          onClick={() => { setOpen(!open); setSaved(false); }}
        >
          <Bookmark className="size-4" />
          Save to trip
        </Button>

      {open && <div className="mt-3 rounded-xl border p-4">
        {saved ? (
          <div className="space-y-3" role="status">
            <Check className="text-primary" />
            <p className="font-semibold">
              {data.owner
                ? "Saved to your trip"
                : "Added to your session shortlist"}
            </p>
            <Button asChild className="w-full">
              <Link href="/trips">View my trips</Link>
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await act({
                  action: "save",
                  ...(tripId ? { tripId } : { name }),
                  leg,
                  snapshot: flightSnapshot(row, price, pax),
                });
                setSaved(true);
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Could not save this flight.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3 className="font-semibold">Keep this option</h3>
            <p className="text-xs text-muted-foreground">
              {data.owner
                ? "Private to your account. Saved prices are snapshots, not reservations."
                : "Temporary shortlist for this session. It clears on reload. Sign in before saving to keep trips in your account."}
            </p>
            <label className="trip-label">
              Trip
              <select value={tripId} onChange={(e) => setTrip(e.target.value)}>
                <option value="">Create a new trip</option>
                {data.trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {!tripId && (
              <label className="trip-label">
                Trip name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  required
                />
              </label>
            )}
            <label className="trip-label">
              Use as
              <select
                value={leg}
                onChange={(e) => setLeg(e.target.value as TripLeg)}
              >
                <option value="outbound">Outbound option</option>
                <option value="return">Return option</option>
                <option value="alternative">Alternative</option>
              </select>
            </label>
            {(error || loadError) && (
              <p role="alert" className="text-sm text-destructive">
                {error || loadError}
              </p>
            )}
            <Button className="w-full" disabled={busy || !ready}>
              {busy ? "Saving…" : data.owner ? "Save flight" : "Add to session"}
            </Button>
          </form>
        )}
      </div>}
    </div>
  );
}
