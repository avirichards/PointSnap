"use client";
import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Armchair,
  ChevronDown,
  Minus,
  Plus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CABIN_LABEL,
  CABIN_ORDER,
  type Cabin,
  type SearchQuery,
} from "@/lib/types";
import { airportPairs } from "@/lib/search-places";
import { AIRPORTS } from "@/db/seed/airports";
import { AirportCombobox } from "./airport-combobox";
import { DatePicker } from "./date-picker";
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
  const [draft, setDraft] = useState<SearchQuery>({
      ...initialQuery,
      // Preserve legacy links once, then let each calendar change independently.
      returnFlexDays: initialQuery.returnFlexDays ?? initialQuery.flexDays ?? 0,
    }),
    [message, setMessage] = useState("");
  const dates = useMemo(() => {
    const today = new Date();
    return {
      min: new Date(today.getTime() - today.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10),
      max: new Date(today.getTime() + 366 * 86400000)
        .toISOString()
        .slice(0, 10),
    };
  }, []);
  function change(patch: Partial<SearchQuery>) {
    const next = { ...draft, ...patch };
    if (
      patch.departDate &&
      next.returnDate &&
      patch.departDate > next.returnDate
    )
      next.returnDate = patch.departDate;
    setDraft(next);
    onDraftChange?.(next);
    setMessage("");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !/^[A-Z]{3}$/.test(draft.origin) ||
      !/^[A-Z]{3}$/.test(draft.dest) ||
      draft.origin === draft.dest
    ) {
      setMessage("Choose different departure and destination airports.");
      return;
    }
    if (
      draft.departDate < dates.min ||
      draft.departDate > dates.max ||
      (draft.returnDate &&
        (draft.returnDate < draft.departDate || draft.returnDate > dates.max))
    ) {
      setMessage("Choose valid travel dates within the next year.");
      return;
    }
    setMessage("");
    onSubmit(draft);
  }
  const airportChecks =
    airportPairs(draft.origin, draft.dest).length *
    (2 * (draft.flexDays ?? 0) + 1);
  return (
    <form onSubmit={submit} className="award-search-form">
      <div className="search-place-field">
        <label htmlFor="origin" className="search-field-label">
          From
        </label>
        <AirportCombobox
          id="origin"
          value={draft.origin}
          initialLabel={AIRPORTS.find((a) => a.iata === draft.origin)?.city}
          onChange={(origin) => change({ origin })}
          placeholder="City or airport"
        />
      </div>
      <button
        type="button"
        className="swap-airports"
        aria-label="Swap departure and destination"
        onClick={() => change({ origin: draft.dest, dest: draft.origin })}
      >
        <ArrowLeftRight className="size-4" />
      </button>
      <div className="search-place-field">
        <label htmlFor="dest" className="search-field-label">
          To
        </label>
        <AirportCombobox
          id="dest"
          value={draft.dest}
          initialLabel={AIRPORTS.find((a) => a.iata === draft.dest)?.city}
          onChange={(dest) => change({ dest })}
          placeholder="City or airport"
        />
      </div>
      <DatePicker
        id="depart"
        label="Departure"
        value={draft.departDate}
        min={dates.min}
        max={dates.max}
        onChange={(departDate) => departDate && change({ departDate })}
        flexibility={draft.flexDays ?? 0}
        onFlexibilityChange={(flexDays) => change({ flexDays })}
      />
      <DatePicker
        id="return-date"
        label="Return"
        value={draft.returnDate}
        min={draft.departDate}
        max={dates.max}
        optional
        onChange={(returnDate) => change({ returnDate })}
        flexibility={draft.returnFlexDays ?? draft.flexDays ?? 0}
        onFlexibilityChange={(returnFlexDays) => change({ returnFlexDays })}
      />
      <div className="search-travelers-field">
        <label id="travelers-label" className="search-field-label">
          Travelers & cabin
        </label>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="travelers-trigger"
              aria-labelledby="travelers-label travelers-value"
            >
              <span id="travelers-value">
                {draft.pax} adult{draft.pax > 1 ? "s" : ""}
                <span className="travelers-cabin">
                  {CABIN_LABEL[draft.minCabin]}
                  {draft.minCabin !== "F" ? " or higher" : ""}
                </span>
              </span>
              <ChevronDown className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="travelers-popover">
            <div className="traveler-counter">
              <div>
                <strong>
                  <Users className="size-4" /> Adults
                </strong>
                <span>Adult travelers</span>
              </div>
              <div>
                <button
                  type="button"
                  aria-label="Remove one adult"
                  disabled={draft.pax === 1}
                  onClick={() => change({ pax: draft.pax - 1 })}
                >
                  <Minus className="size-4" />
                </button>
                <output aria-live="polite">{draft.pax}</output>
                <button
                  type="button"
                  aria-label="Add one adult"
                  disabled={draft.pax === 9}
                  onClick={() => change({ pax: draft.pax + 1 })}
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
            <fieldset className="cabin-picker">
              <legend>
                <Armchair className="size-4" /> Minimum cabin
              </legend>
              <p>Include this cabin and higher cabins.</p>
              {CABIN_ORDER.map((cabin) => (
                <label key={cabin}>
                  <input
                    type="radio"
                    name="search-cabin"
                    checked={draft.minCabin === cabin}
                    onChange={() => change({ minCabin: cabin as Cabin })}
                  />
                  <span>{CABIN_LABEL[cabin]}</span>
                </label>
              ))}
            </fieldset>
          </PopoverContent>
        </Popover>
      </div>
      <Button
        type="submit"
        className="search-submit"
        aria-label={
          isStreaming ? "Search with updated criteria" : "Find award flights"
        }
      >
        Search
        <ArrowRight className="size-4" />
      </Button>
      {airportChecks > 20 && (
        <p className="search-form-note">
          This broad search includes up to {airportChecks} airport/date
          combinations. Wider windows take longer; searches resume automatically
          if a limit is reached.
        </p>
      )}
      {message && (
        <p role="alert" className="search-form-error">
          {message}
        </p>
      )}
    </form>
  );
}
