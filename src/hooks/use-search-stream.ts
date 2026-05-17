"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  SearchQuery,
  SearchResultRow,
  SearchStreamEvent,
} from "@/lib/types";

export interface ProgramStatus {
  programId: string;
  state: "pending" | "success" | "partial" | "failed" | "circuit_open";
  arrivedAt?: number;
}

export interface UseSearchStreamReturn {
  rows: SearchResultRow[];
  programs: ProgramStatus[];
  meta: { searchId: string; pax: number } | null;
  durationMs: number | null;
  isStreaming: boolean;
}

const queryKey = (q: SearchQuery) =>
  `${q.origin}|${q.dest}|${q.departDate}|${q.returnDate ?? ""}|${q.pax}|${q.minCabin}`;

export function useSearchStream(
  query: SearchQuery | null,
): UseSearchStreamReturn {
  const [rows, setRows] = useState<SearchResultRow[]>([]);
  const [programs, setPrograms] = useState<ProgramStatus[]>([]);
  const [meta, setMeta] = useState<{ searchId: string; pax: number } | null>(
    null,
  );
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!query) return;
    const key = queryKey(query);
    if (lastKey.current === key) return;
    lastKey.current = key;

    setRows([]);
    setPrograms([]);
    setMeta(null);
    setDurationMs(null);
    setIsStreaming(true);

    const params = new URLSearchParams({
      origin: query.origin,
      dest: query.dest,
      departDate: query.departDate,
      pax: String(query.pax),
      minCabin: query.minCabin,
    });
    if (query.returnDate) params.set("returnDate", query.returnDate);
    const es = new EventSource(`/api/search?${params.toString()}`);

    es.onmessage = (e) => {
      const event = JSON.parse(e.data) as SearchStreamEvent;
      switch (event.type) {
        case "meta":
          setMeta({ searchId: event.searchId, pax: event.pax });
          setPrograms(
            event.programs.map((programId) => ({
              programId,
              state: "pending" as const,
            })),
          );
          break;
        case "partial":
          setRows((prev) => [...prev, ...event.rows]);
          break;
        case "program_done":
          setPrograms((prev) =>
            prev.map((p) =>
              p.programId === event.programId
                ? { ...p, state: event.status, arrivedAt: Date.now() }
                : p,
            ),
          );
          break;
        case "confidence_update":
          setRows((prev) =>
            prev.map((r) =>
              r.id === event.resultId
                ? { ...r, confidenceScore: event.newScore }
                : r,
            ),
          );
          break;
        case "complete":
          setDurationMs(event.durationMs);
          setIsStreaming(false);
          es.close();
          break;
      }
    };

    es.onerror = () => {
      setIsStreaming(false);
      es.close();
    };

    return () => {
      es.close();
      setIsStreaming(false);
    };
  }, [query]);

  return useMemo(
    () => ({ rows, programs, meta, durationMs, isStreaming }),
    [rows, programs, meta, durationMs, isStreaming],
  );
}
