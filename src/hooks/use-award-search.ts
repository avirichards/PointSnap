"use client";
import { useEffect, useState, useCallback } from "react";
import type { AwardResult, Coverage } from "@/lib/award-search/types";
import { readEvents } from "@/lib/award-search/sse";
export function useAwardSearch(params: string | null) {
  const [rows, setRows] = useState<AwardResult[]>([]);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!params) return;
    const controller = new AbortController();
    let complete = false;
    // Reset belongs to this request; StrictMode cleanup cancels only its own request.
    const update = () => !controller.signal.aborted;
    async function run() {
      setRows([]);
      setCoverage([]);
      setError("");
      setDuration(null);
      setLoading(true);
      try {
        const res = await fetch(`/api/search?${params}`, {
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
            setCoverage(
              event.programs.map((programId) => ({
                programId,
                state: "pending",
              })),
            );
          if (event.type === "results")
            setRows((previous) => {
              const map = new Map(previous.map((r) => [r.id, r]));
              event.rows.forEach((r) => map.set(r.id, r));
              return [...map.values()];
            });
          if (event.type === "coverage")
            setCoverage((previous) =>
              previous.map((c) =>
                c.programId === event.coverage.programId ? event.coverage : c,
              ),
            );
          if (event.type === "error") setError(event.message);
          if (event.type === "complete") {
            complete = true;
            setDuration(event.durationMs);
          }
        });
        if (update() && !complete)
          setError(
            "The search connection ended early. Retry to check remaining programs.",
          );
      } catch (e) {
        if (update())
          setError(
            e instanceof Error
              ? e.message
              : "Could not search. Please try again.",
          );
      } finally {
        if (update()) {
          setLoading(false);
          setCoverage((previous) =>
            previous.map((c) =>
              c.state === "pending"
                ? { ...c, state: "error", message: "Search interrupted." }
                : c,
            ),
          );
        }
      }
    }
    void run();
    return () => controller.abort();
  }, [params, revision]);
  const retry = useCallback(() => setRevision((r) => r + 1), []);
  return { rows, coverage, loading, error, duration, retry };
}
