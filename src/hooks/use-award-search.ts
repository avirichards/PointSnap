"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import type { AwardResult } from "@/lib/award-search/types";
import { readEvents } from "@/lib/award-search/sse";
import {
  searchDates,
  summarizeCoverage,
  type DaySearch,
} from "@/lib/award-search/date-window";
export function useAwardSearch(params: string | null) {
  const [rows, setRows] = useState<AwardResult[]>([]),
    [days, setDays] = useState<DaySearch[]>([]),
    [loading, setLoading] = useState(!!params),
    [error, setError] = useState(""),
    [duration, setDuration] = useState<number | null>(null),
    [revision, setRevision] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!params) return;
    const controller = new AbortController();
    active.current = controller;
    const started = Date.now();
    const update = () => !controller.signal.aborted;
    const patch = (date: string, fn: (d: DaySearch) => DaySearch) => {
      if (update())
        setDays((previous) =>
          previous.map((d) => (d.date === date ? fn(d) : d)),
        );
    };
    async function run() {
      setRows([]);
      setDays([]);
      setError("");
      setDuration(null);
      setLoading(true);
      const base = new URLSearchParams(params!);
      const central = base.get("departDate")!,
        flex = Number(base.get("flexDays") ?? 0);
      const dates = searchDates(
        central,
        flex,
        new Date(),
        base.get("windowMin") ?? undefined,
        base.get("windowMax") ?? undefined,
      );
      setDays(dates.map((date) => ({ date, state: "queued", coverage: [] })));
      // Start the requested day first, then fill neighboring days. Two date searches maximum.
      const queue = [...dates].sort(
        (a, b) =>
          Math.abs(Date.parse(a) - Date.parse(central)) -
            Math.abs(Date.parse(b) - Date.parse(central)) || a.localeCompare(b),
      );
      let index = 0;
      async function worker() {
        while (index < queue.length && update()) {
          const date = queue[index++];
          let complete = false;
          patch(date, (d) => ({ ...d, state: "searching" }));
          const query = new URLSearchParams(base);
          query.set("departDate", date);
          query.delete("flexDays");
          query.delete("windowMin");
          query.delete("windowMax");
          try {
            const res = await fetch(`/api/search?${query}`, {
              signal: controller.signal,
              cache: "no-store",
            });
            if (!res.ok) {
              const body = await res.json();
              throw new Error(body.message ?? "Search failed.");
            }
            if (!res.body) throw new Error("No response from search.");
            await readEvents(res.body, (event) => {
              if (!update()) return;
              if (event.type === "meta")
                patch(date, (d) => ({
                  ...d,
                  coverage: event.programs.map((programId) => ({
                    programId,
                    state: "pending",
                  })),
                }));
              if (event.type === "results")
                setRows((previous) => {
                  const map = new Map(
                    previous.map((r) => [`${r.date}:${r.id}`, r]),
                  );
                  event.rows.forEach((r) => map.set(`${r.date}:${r.id}`, r));
                  return [...map.values()];
                });
              if (event.type === "coverage")
                patch(date, (d) => ({
                  ...d,
                  coverage: [
                    ...d.coverage.filter(
                      (c) => c.programId !== event.coverage.programId,
                    ),
                    event.coverage,
                  ],
                }));
              if (event.type === "error") throw new Error(event.message);
              if (event.type === "complete") complete = true;
            });
            if (!complete) throw new Error("Search connection ended early.");
            patch(date, (d) => ({
              ...d,
              state: d.coverage.some((c) => c.state === "error")
                ? "error"
                : "complete",
              coverage: d.coverage.map((c) =>
                c.state === "pending"
                  ? { ...c, state: "error", message: "Source did not finish." }
                  : c,
              ),
            }));
          } catch (e) {
            if (update()) {
              const message =
                e instanceof Error ? e.message : "Search interrupted.";
              patch(date, (d) => ({
                ...d,
                state: "error",
                message,
                coverage: d.coverage.map((c) =>
                  c.state === "pending" ? { ...c, state: "error", message } : c,
                ),
              }));
              setError(
                `${date}: ${message} Other returned results remain available.`,
              );
            }
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(2, queue.length) }, worker),
      );
      if (update()) {
        setLoading(false);
        setDuration(Date.now() - started);
      }
    }
    void run().catch((e) => {
      if (update()) {
        setError(e instanceof Error ? e.message : "Search failed.");
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [params, revision]);
  const retry = useCallback(() => setRevision((r) => r + 1), []);
  const stop = useCallback(() => {
    active.current?.abort();
    setLoading(false);
    setDays((previous) =>
      previous.map((d) =>
        d.state === "queued" || d.state === "searching"
          ? {
              ...d,
              state: "cancelled",
              coverage: d.coverage.map((c) =>
                c.state === "pending"
                  ? { ...c, state: "error", message: "Search stopped." }
                  : c,
              ),
            }
          : d,
      ),
    );
    setError("Search stopped. Results already received remain available.");
  }, []);
  const coverage = useMemo(() => summarizeCoverage(days), [days]);
  return {
    rows,
    coverage,
    loading,
    error,
    duration,
    retry,
    stop,
    days,
    dates: days.map((d) => d.date),
  };
}
