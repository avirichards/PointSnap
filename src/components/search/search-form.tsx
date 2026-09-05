"use client";
import { useMemo, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, ArrowRight, Loader2 } from "lucide-react";
import type { Cabin, SearchQuery } from "@/lib/types";
import { AirportCombobox } from "./airport-combobox";
interface Props {
  initialQuery: SearchQuery;
  onSubmit: (q: SearchQuery) => void;
  onDraftChange?: (q: SearchQuery) => void;
  isStreaming?: boolean;
}
export function SearchForm({
  initialQuery,
  onSubmit,
  onDraftChange,
  isStreaming,
}: Props) {
  const [draft, setDraft] = useState(initialQuery);
  const [message, setMessage] = useState("");
  const dates = useMemo(() => {
    const today = new Date();
    const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
    return {
      min: local,
      max: new Date(today.getTime() + 366 * 86400000)
        .toISOString()
        .slice(0, 10),
    };
  }, []);
  function change(patch: Partial<SearchQuery>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    onDraftChange?.(next);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (
      !/^[A-Z]{3}$/.test(draft.origin) ||
      !/^[A-Z]{3}$/.test(draft.dest) ||
      draft.origin === draft.dest
    ) {
      setMessage("Choose two different airports.");
      return;
    }
    if (draft.returnDate && draft.returnDate < draft.departDate) {
      setMessage("Return date must follow departure.");
      return;
    }
    setMessage("");
    onSubmit(draft);
  }
  return (
    <form onSubmit={submit} className="award-search-form">
      <div className="grid gap-2">
        <Label htmlFor="origin" className="mono-label">
          Departure
        </Label>
        <AirportCombobox
          id="origin"
          value={draft.origin}
          onChange={(origin) => change({ origin })}
          placeholder="Airport or city"
        />
      </div>
      <button
        type="button"
        className="swap-airports"
        aria-label="Swap departure and destination"
        onClick={() => change({ origin: draft.dest, dest: draft.origin })}
      >
        <ArrowLeftRight className="size-3.5" />
      </button>
      <div className="grid gap-2">
        <Label htmlFor="dest" className="mono-label">
          Destination
        </Label>
        <AirportCombobox
          id="dest"
          value={draft.dest}
          onChange={(dest) => change({ dest })}
          placeholder="Airport or city"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="depart" className="mono-label">
          Departure date
        </Label>
        <Input
          id="depart"
          type="date"
          value={draft.departDate}
          onChange={(e) => change({ departDate: e.target.value })}
          min={dates.min}
          max={dates.max}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="return-date" className="mono-label">
          Return{" "}
          <span className="normal-case tracking-normal opacity-65">
            optional
          </span>
        </Label>
        <Input
          id="return-date"
          type="date"
          value={draft.returnDate ?? ""}
          onChange={(e) => change({ returnDate: e.target.value || undefined })}
          min={draft.departDate}
          max={dates.max}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pax" className="mono-label">
          Travelers
        </Label>
        <select
          id="pax"
          className="search-native-select"
          value={draft.pax}
          onChange={(e) => change({ pax: Number(e.target.value) })}
        >
          {Array.from({ length: 9 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1} adult{i ? "s" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="cabin" className="mono-label">
          Minimum cabin
        </Label>
        <select
          id="cabin"
          className="search-native-select"
          value={draft.minCabin}
          onChange={(e) => change({ minCabin: e.target.value as Cabin })}
        >
          <option value="Y">Economy</option>
          <option value="W">Premium</option>
          <option value="J">Business</option>
          <option value="F">First</option>
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="flex-days" className="mono-label">
          Date flexibility
        </Label>
        <select
          id="flex-days"
          className="search-native-select"
          value={draft.flexDays ?? 0}
          onChange={(e) => change({ flexDays: Number(e.target.value) })}
        >
          <option value="0">Exact date</option>
          {[1, 2, 3, 5, 7].map((n) => (
            <option key={n} value={n}>
              ± {n} day{n > 1 ? "s" : ""} ({n * 2 + 1} total)
            </option>
          ))}
        </select>
      </div>
      <Button
        type="submit"
        className="search-submit h-11"
        disabled={isStreaming}
        aria-busy={isStreaming || undefined}
      >
        {isStreaming ? (
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
        ) : null}
        {isStreaming ? "Searching" : "Find awards"}
        <ArrowRight className="size-4" />
      </Button>
      {message && (
        <p role="alert" className="col-span-full text-sm text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}
