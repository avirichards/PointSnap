"use client";

/**
 * Phase 4 — per-program award booking window.
 *
 * Fetches `/api/programs-meta` (which proxies the worker's
 * `/programs/meta`) once and exposes a helper that resolves the max
 * date a search is valid for.
 *
 * The award-search form fans out to *every* registered program at once,
 * so the calendar must allow any date that is in-window for *at least
 * one* program — i.e. the MAX of the per-program windows. `maxDaysOut()`
 * below takes an optional program-id subset and returns that max; with
 * no argument it uses every program the worker reported.
 *
 * Degrades gracefully: until the fetch resolves (or if the worker is
 * unreachable) `maxDate` is `null`, which the caller treats as "no upper
 * bound" — the picker stays fully open rather than wrongly blocking
 * dates.
 */
import { useEffect, useMemo, useState } from "react";

interface ProgramWindow {
  programId: string;
  maxDaysOut: number;
}

interface ProgramsMeta {
  programs: ProgramWindow[];
  defaultMaxDaysOut: number;
}

export interface UseProgramWindowsReturn {
  /** Per-program window (days from today). Empty until the fetch lands. */
  windows: ProgramWindow[];
  /** Fallback window for any program id not in `windows`. */
  defaultMaxDaysOut: number;
  /** True only while the initial fetch is in flight. */
  loading: boolean;
  /**
   * Largest booking window (days from today) across the given programs,
   * or across every known program when no subset is passed. Returns
   * `null` while loading / when nothing is known — caller treats `null`
   * as "no upper bound".
   */
  maxDaysOut: (programIds?: readonly string[]) => number | null;
  /**
   * `maxDaysOut` resolved to a `YYYY-MM-DD` string (the value for an
   * `<input type="date" max=...>`). `null` when unknown.
   */
  maxDate: (programIds?: readonly string[]) => string | null;
}

/** Local `YYYY-MM-DD` for `today + days`. Matches the form's date format. */
function isoDatePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  // Use local date parts — `<input type="date">` is timezone-naive, and
  // toISOString() would shift the day for users west of UTC.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function useProgramWindows(): UseProgramWindowsReturn {
  const [meta, setMeta] = useState<ProgramsMeta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/programs-meta", { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ProgramsMeta>) : null))
      .then((j) => {
        if (j && Array.isArray(j.programs)) setMeta(j);
      })
      .catch(() => {
        // Network error — leave `meta` null; caller falls back to an
        // unbounded calendar.
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  return useMemo<UseProgramWindowsReturn>(() => {
    const windows = meta?.programs ?? [];
    const defaultMaxDaysOut = meta?.defaultMaxDaysOut ?? 330;

    const maxDaysOut = (programIds?: readonly string[]): number | null => {
      if (windows.length === 0) return null;
      const byId = new Map(windows.map((w) => [w.programId, w.maxDaysOut]));
      const ids = programIds && programIds.length > 0 ? programIds : null;
      const values = ids
        ? ids.map((id) => byId.get(id) ?? defaultMaxDaysOut)
        : windows.map((w) => w.maxDaysOut);
      if (values.length === 0) return null;
      return Math.max(...values);
    };

    const maxDate = (programIds?: readonly string[]): string | null => {
      const days = maxDaysOut(programIds);
      return days === null ? null : isoDatePlusDays(days);
    };

    return { windows, defaultMaxDaysOut, loading, maxDaysOut, maxDate };
  }, [meta, loading]);
}
