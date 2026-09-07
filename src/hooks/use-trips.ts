"use client";
import { useEffect, useSyncExternalStore } from "react";
import { tripAction, type TripData } from "@/lib/trips";
import type { z } from "zod";
const empty: TripData = { owner: null, trips: [], flights: [] };
let data: TripData = empty,
  guest: TripData = empty,
  loaded = false,
  error = "";
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
async function refresh() {
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch("/api/trips", { cache: "no-store" });
      if (res.status === 401) {
        data = guest;
        error = "";
      } else if (res.ok) {
        data = await res.json();
        error = "";
      } else {
        error = "Your saved trips are unavailable. Please retry.";
      }
    } catch {
      error = "Could not load saved trips. Please retry.";
    } finally {
      loaded = true;
      pending = null;
      emit();
    }
  })();
  return pending;
}
export function useTrips() {
  const value = useSyncExternalStore(
    subscribe,
    () => data,
    () => empty,
  );
  const problem = useSyncExternalStore(
    subscribe,
    () => error,
    () => "",
  );
  const ready = useSyncExternalStore(
    subscribe,
    () => loaded,
    () => false,
  );
  useEffect(() => {
    if (!loaded) void refresh();
  }, []);
  async function act(action: z.infer<typeof tripAction>) {
    const input = tripAction.parse(action);
    if (!loaded) await refresh();
    if (error) throw new Error(error);
    if (data.owner) {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message ?? "Your trip could not be saved.");
      }
      await refresh();
      return;
    }
    if (input.action === "save") {
      const tripId = input.tripId ?? crypto.randomUUID();
      const now = new Date().toISOString();
      data = {
        ...data,
        trips: input.tripId
          ? data.trips
          : [{ id: tripId, name: input.name!, created_at: now }, ...data.trips],
        flights: [
          ...data.flights,
          {
            id: crypto.randomUUID(),
            trip_id: tripId,
            leg: input.leg,
            snapshot: input.snapshot,
            created_at: now,
          },
        ],
      };
    }
    if (input.action === "rename")
      data = {
        ...data,
        trips: data.trips.map((t) =>
          t.id === input.tripId ? { ...t, name: input.name } : t,
        ),
      };
    if (input.action === "removeFlight")
      data = {
        ...data,
        flights: data.flights.filter((f) => f.id !== input.id),
      };
    if (input.action === "removeTrip")
      data = {
        ...data,
        trips: data.trips.filter((t) => t.id !== input.id),
        flights: data.flights.filter((f) => f.trip_id !== input.id),
      };
    guest = data;
    emit();
  }
  return { data: value, error: problem, ready, act, refresh };
}
