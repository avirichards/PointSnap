"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { rememberSearch } from "@/lib/search-history";
import type { AwardResult } from "@/lib/award-search/types";
import { readEvents } from "@/lib/award-search/sse";
import {
  aggregateSearchDays,
  buildSearchTasks,
  summarizeCoverage,
  type SearchTask,
} from "@/lib/award-search/date-window";
export function useAwardSearch(params: string | null) {
  const [rows, setRows] = useState<AwardResult[]>([]),
    [tasks, setTasks] = useState<SearchTask[]>([]),
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
    const patch = (id: string, fn: (d: SearchTask) => SearchTask) => {
      if (update())
        setTasks((previous) => previous.map((d) => (d.id === id ? fn(d) : d)));
    };
    async function run() {
      const observed = new Map<string, AwardResult>();
      setRows([]);
      setTasks([]);
      setError("");
      setDuration(null);
      setLoading(true);
      const base = new URLSearchParams(params!);
      const central = base.get("departDate")!,
        flex = Number(base.get("flexDays") ?? 0);
      const initial = buildSearchTasks(
        base.get("origin")!,
        base.get("dest")!,
        central,
        flex,
        new Date(),
        base.get("windowMin") ?? undefined,
        base.get("windowMax") ?? undefined,
      );
      setTasks(initial);
      // One shared queue bounds city x date expansion to two physical searches.
      const queue = [...initial].sort(
        (a, b) =>
          Math.abs(Date.parse(a.date) - Date.parse(central)) -
            Math.abs(Date.parse(b.date) - Date.parse(central)) ||
          a.date.localeCompare(b.date),
      );
      let index = 0;
      async function worker() {
        while (index < queue.length && update()) {
          const { id, date, origin, destination } = queue[index++];
          let complete = false;
          patch(id, (d) => ({ ...d, state: "searching" }));
          const query = new URLSearchParams(base);
          query.set("departDate", date);
          query.set("origin", origin);
          query.set("dest", destination);
          query.delete("returnDate");
          query.delete("returnFlexDays");
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
                patch(id, (d) => ({
                  ...d,
                  coverage: event.programs.map((programId) => ({
                    programId,
                    state: "pending",
                  })),
                }));
              if (event.type === "results") {
                event.rows.forEach((r) =>
                  observed.set(
                    `${r.programId}:${r.origin}:${r.destination}:${r.date}:${r.id}`,
                    r,
                  ),
                );
                setRows((previous) => {
                  const map = new Map(
                    previous.map((r) => [
                      `${r.programId}:${r.origin}:${r.destination}:${r.date}:${r.id}`,
                      r,
                    ]),
                  );
                  event.rows.forEach((r) =>
                    map.set(
                      `${r.programId}:${r.origin}:${r.destination}:${r.date}:${r.id}`,
                      r,
                    ),
                  );
                  return [...map.values()];
                });
              }
              if (event.type === "coverage")
                patch(id, (d) => ({
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
            patch(id, (d) => ({
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
              patch(id, (d) => ({
                ...d,
                state: "error",
                message,
                coverage: d.coverage.map((c) =>
                  c.state === "pending" ? { ...c, state: "error", message } : c,
                ),
              }));
              setError(
                `${origin}–${destination}, ${date}: ${message} Other returned results remain available.`,
              );
            }
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(2, queue.length) }, worker),
      );
      rememberSearch(params!, [...observed.values()]);
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
    setTasks((previous) =>
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
  const coverage = useMemo(() => summarizeCoverage(tasks), [tasks]);
  const days = useMemo(() => aggregateSearchDays(tasks), [tasks]);
  return {
    rows,
    coverage,
    loading,
    error,
    duration,
    retry,
    stop,
    days,
    tasks,
    dates: days.map((d) => d.date),
  };
}
