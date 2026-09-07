"use client";
import { FilterPresets } from "./filter-presets";
import { DisplayPreferences } from "./display-currency";
import { stopAirports } from "@/lib/award-search/stops";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coins,
  Plane,
  Route,
  Search,
  SlidersHorizontal,
  Armchair,
  WalletCards,
  X,
} from "lucide-react";
import { TimeField, useTimeFormat } from "./time-preference";
import { CABIN_LABEL, CABIN_ORDER } from "@/lib/types";
import { PROGRAMS } from "@/lib/programs";
import { AIRLINES } from "@/db/seed/airlines";
import {
  activeFilterCount,
  defaultFilters,
  type FlightGroup,
  type ResultFilters,
} from "@/lib/award-search/comparison";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type FilterSection =
  | "cabin"
  | "stops"
  | "budget"
  | "airlines"
  | "programs"
  | "times"
  | "connections"
  | "availability"
  | "details";
type Patch = Partial<ResultFilters>;
const sectionKeys: Record<FilterSection, (keyof ResultFilters)[]> = {
  cabin: ["cabins", "mixed", "confirmedCabin"],
  stops: ["maxStops", "maxDuration"],
  budget: ["maxPoints", "maxFees", "minValue", "walletOnly"],
  airlines: ["airlines"],
  programs: ["programs", "transfer"],
  times: [
    "departAfter",
    "departBefore",
    "arriveAfter",
    "arriveBefore",
    "days",
    "noOvernight",
  ],
  connections: ["minLayover", "maxLayover", "via", "avoid"],
  availability: ["minSeats", "refundable", "live", "maxAge"],
  details: ["text", "aircraft", "fare"],
};
const sections = [
  {
    id: "cabin",
    name: "Cabin",
    icon: Armchair,
    hint: "Economy, premium, business or first",
  },
  {
    id: "stops",
    name: "Stops",
    icon: Route,
    hint: "Nonstop flights and journey length",
  },
  {
    id: "budget",
    name: "Points & fees",
    icon: Coins,
    hint: "Your points and cash budget",
  },
  {
    id: "airlines",
    name: "Airlines",
    icon: Plane,
    hint: "Who operates your flights",
  },
  {
    id: "programs",
    name: "Programs",
    icon: WalletCards,
    hint: "Which points you can book with",
  },
  {
    id: "times",
    name: "Times",
    icon: Clock3,
    hint: "Departure, arrival and weekdays",
  },
  {
    id: "connections",
    name: "Connections",
    icon: Route,
    hint: "Airports and time between flights",
  },
  {
    id: "availability",
    name: "Availability",
    icon: Check,
    hint: "Seats, flexibility and freshness",
  },
  {
    id: "details",
    name: "Flight details",
    icon: Search,
    hint: "Flight number, aircraft or fare class",
  },
] as const;
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const watchCompact = (fn: () => void) => {
  const media = window.matchMedia("(max-width: 640px)");
  media.addEventListener("change", fn);
  return () => media.removeEventListener("change", fn);
};
const isCompact = () => window.matchMedia("(max-width: 640px)").matches;
const wideOnServer = () => false;
const hasValue = (value: ResultFilters[keyof ResultFilters]) =>
  Array.isArray(value) ? value.length > 0 : value !== "" && value !== false;
const programName = (id: string) =>
  PROGRAMS.find((p) => p.id === id)?.name ?? id;
const compactPoints = (value: string) =>
  Number(value).toLocaleString("en-US", {
    notation: Number(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  });

function Choice({
  checked,
  onChange,
  children,
  detail,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <label className="filter-choice">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="peer sr-only"
      />
      <span className="filter-checkbox" aria-hidden="true">
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        {children}
        {detail && (
          <span className="block text-xs text-muted-foreground mt-0.5">
            {detail}
          </span>
        )}
      </span>
    </label>
  );
}
function Switch({
  checked,
  onChange,
  children,
  detail,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
  detail?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`filter-switch-row ${disabled ? "opacity-50" : ""}`}>
      <span className="min-w-0 flex-1">
        {children}
        {detail && (
          <span className="block mt-1 text-xs text-muted-foreground leading-relaxed">
            {detail}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="peer sr-only"
      />
      <span className="filter-switch-track" aria-hidden="true">
        <span />
      </span>
    </label>
  );
}
function FilterGroup({
  title,
  children,
  hint,
}: {
  title: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <fieldset className="filter-fieldset">
      <legend>{title}</legend>
      {hint && (
        <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
          {hint}
        </p>
      )}
      {children}
    </fieldset>
  );
}

export function ResultFilterBar({
  value: f,
  onChange,
  groups,
  walletAvailable,
  matchingCount,
}: {
  value: ResultFilters;
  onChange: (f: ResultFilters) => void;
  groups: FlightGroup[];
  walletAvailable: boolean;
  matchingCount: number;
}) {
  const { time } = useTimeFormat();
  const compact = useSyncExternalStore(watchCompact, isCompact, wideOnServer);
  const [sheet, setSheet] = useState<FilterSection | "all" | null>(null);
  const [popover, setPopover] = useState<FilterSection | null>(null);
  const change = (patch: Patch) => {
    onChange({ ...f, ...patch });
  };
  const reset = () => {
    onChange({ ...defaultFilters(), feeCurrency: f.feeCurrency });
  };
  const toggle = (
    key: "programs" | "airlines" | "cabins" | "days",
    value: string,
  ) =>
    change({
      [key]: f[key].includes(value as never)
        ? f[key].filter((v) => v !== value)
        : [...f[key], value],
    });
  const clearSection = (id: FilterSection) => {
    const base = defaultFilters();
    change(Object.fromEntries(sectionKeys[id].map((key) => [key, base[key]])));
  };
  const programIds = [...new Set(groups.flatMap((g) => g.programs))].sort(
    (a, b) => programName(a).localeCompare(programName(b)),
  );
  const airlines = [
    ...new Map(
      groups.flatMap((g) =>
        g.row.segments.map((s) => {
          const id = s.operatingAirline ?? s.airline;
          const name =
            AIRLINES.find((a) => a.iata === id)?.name ??
            s.operatedBy?.replace(/^Operated by /i, "") ??
            s.airlineName ??
            id;
          return [id, { id, name }] as const;
        }),
      ),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const connections = [
    ...new Set(
      groups.flatMap((g) => [
        ...stopAirports(g.row),
        ...g.row.segments.slice(1).map((s) => s.origin),
      ]),
    ),
  ].sort();
  const transfers = [
    ...new Set(
      groups.flatMap((g) =>
        g.offers.flatMap(
          (o) => o.price.transferOptions?.map((t) => t.currencyId) ?? [],
        ),
      ),
    ),
  ];
  const sectionCount = (id: FilterSection) =>
    sectionKeys[id].filter((key) => hasValue(f[key])).length;
  const count = activeFilterCount(f);
  const field = (
    key: keyof ResultFilters,
    label: string,
    type = "number",
    placeholder = "Any",
  ) =>
    type === "time" ? (
      <TimeField
        label={label}
        value={String(f[key])}
        onChange={(value) => change({ [key]: value })}
      />
    ) : (
      <label className="filter-field">
        <span>{label}</span>
        <Input
          type={type}
          min={type === "number" ? 0 : undefined}
          step={type === "number" ? "any" : undefined}
          inputMode={type === "number" ? "decimal" : undefined}
          value={String(f[key])}
          onChange={(e) => change({ [key]: e.target.value })}
          placeholder={placeholder}
        />
      </label>
    );
  const check = (
    key:
      | "mixed"
      | "confirmedCabin"
      | "noOvernight"
      | "live"
      | "refundable"
      | "walletOnly",
    label: string,
    detail?: string,
    disabled?: boolean,
  ) => (
    <Switch
      checked={f[key]}
      onChange={() => change({ [key]: !f[key] })}
      detail={detail}
      disabled={disabled}
    >
      {label}
    </Switch>
  );
  const presets = (
    key: "maxPoints" | "maxFees",
    values: number[],
    format: (n: number) => string,
  ) => (
    <div className="flex gap-2 mt-2">
      {values.map((n) => (
        <button
          type="button"
          key={n}
          className="filter-preset"
          aria-pressed={f[key] === String(n)}
          onClick={() =>
            change({ [key]: f[key] === String(n) ? "" : String(n) })
          }
        >
          {format(n)}
        </button>
      ))}
    </div>
  );
  const timeWindow = (kind: "depart" | "arrive") => {
    const after = kind === "depart" ? "departAfter" : "arriveAfter",
      before = kind === "depart" ? "departBefore" : "arriveBefore";
    return (
      <FilterGroup title={kind === "depart" ? "Departure" : "Arrival"}>
        <div className="filter-time-presets">
          {[
            {
              name: "Morning",
              start: "06:00",
              end: "11:59",
              label: "6 am – noon",
            },
            {
              name: "Afternoon",
              start: "12:00",
              end: "17:59",
              label: "Noon – 6 pm",
            },
            {
              name: "Evening",
              start: "18:00",
              end: "23:59",
              label: "6 pm – midnight",
            },
            {
              name: "Early hours",
              start: "00:00",
              end: "05:59",
              label: "Midnight – 6 am",
            },
          ].map((p) => (
            <button
              key={p.name}
              type="button"
              aria-pressed={f[after] === p.start && f[before] === p.end}
              onClick={() =>
                change(
                  f[after] === p.start && f[before] === p.end
                    ? { [after]: "", [before]: "" }
                    : { [after]: p.start, [before]: p.end },
                )
              }
            >
              {p.name}
              <small>
                {time(p.start)} – {time(p.end)}
              </small>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          {field(after, "After", "time")}
          {field(before, "Before", "time")}
        </div>
      </FilterGroup>
    );
  };
  const content = (id: FilterSection) => {
    switch (id) {
      case "cabin":
        return (
          <>
            <FilterGroup
              title="Cabins to include"
              hint="Choose one or more. Leave all clear for any cabin."
            >
              <div className="filter-cabin-grid">
                {CABIN_ORDER.map((c) => (
                  <Choice
                    key={c}
                    checked={f.cabins.includes(c)}
                    onChange={() => toggle("cabins", c)}
                  >
                    {CABIN_LABEL[c]}
                  </Choice>
                ))}
              </div>
            </FilterGroup>
            {check(
              "mixed",
              "Hide mixed cabins",
              "Keep every leg in the cabin you selected.",
            )}
            {check("confirmedCabin", "Confirmed cabins only")}
          </>
        );
      case "stops":
        return (
          <>
            <FilterGroup title="Number of stops">
              <div
                className="filter-segments"
                role="radiogroup"
                aria-label="Maximum stops"
              >
                {[
                  ["", "Any"],
                  ["0", "Nonstop"],
                  ["1", "1 or fewer"],
                ].map(([v, label]) => (
                  <label key={v}>
                    <input
                      type="radio"
                      name="filter-stops"
                      value={v}
                      checked={f.maxStops === v}
                      onChange={() => change({ maxStops: v })}
                      className="peer sr-only"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </FilterGroup>
            {field("maxDuration", "Maximum journey (hours)")}
          </>
        );
      case "budget":
        return (
          <>
            <FilterGroup title="Points per person">
              {field("maxPoints", "Maximum points")}
              {presets(
                "maxPoints",
                [25000, 50000, 100000],
                (n) => `${n / 1000}k`,
              )}
            </FilterGroup>
            <FilterGroup title="Cash per person">
              {field("maxFees", `Maximum fees (${f.feeCurrency})`)}
              {presets("maxFees", [100, 250, 500], (n) => String(n))}
              <p className="text-xs text-muted-foreground mt-2">
                Uses your display currency.
              </p>
            </FilterGroup>
            {check(
              "walletOnly",
              "Within my points balance",
              walletAvailable
                ? "Enough points for every traveler."
                : "Add balances in Wallet to use this.",
              !walletAvailable,
            )}
            <details className="filter-disclosure">
              <summary>
                Redemption value <ChevronDown size={14} />
              </summary>
              <div className="pt-3">
                {field("minValue", "Minimum USD cents per point")}
                <p className="text-xs text-muted-foreground mt-2">
                  Requires a matching cash fare.
                </p>
              </div>
            </details>
          </>
        );
      case "airlines":
        return (
          <FilterGroup
            title="Fly with"
            hint="All legs must be operated by your selected airlines."
          >
            {airlines.length ? (
              airlines.map((a) => (
                <Choice
                  key={a.id}
                  checked={f.airlines.includes(a.id)}
                  onChange={() => toggle("airlines", a.id)}
                  detail={a.id}
                >
                  {a.name}
                </Choice>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Airlines appear as flights arrive.
              </p>
            )}
          </FilterGroup>
        );
      case "programs":
        return (
          <>
            <FilterGroup
              title="Book with"
              hint="The airline you fly and the points you use can be different."
            >
              {programIds.length ? (
                programIds.map((id) => (
                  <Choice
                    key={id}
                    checked={f.programs.includes(id)}
                    onChange={() => toggle("programs", id)}
                  >
                    {programName(id)}
                  </Choice>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Programs appear as flights arrive.
                </p>
              )}
            </FilterGroup>
            {transfers.length > 0 && (
              <label className="filter-field">
                Transfer points from
                <select
                  className="search-native-select"
                  value={f.transfer}
                  onChange={(e) => change({ transfer: e.target.value })}
                >
                  <option value="">Any</option>
                  {transfers.map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        );
      case "times":
        return (
          <>
            <p className="text-xs text-muted-foreground">
              Times are local to each airport.
            </p>
            {timeWindow("depart")}
            {timeWindow("arrive")}
            {check("noOvernight", "Arrive on the same calendar day")}
            <FilterGroup title="Departure days">
              <div className="filter-weekdays">
                {days.map((d, i) => (
                  <button
                    type="button"
                    key={d}
                    aria-label={d}
                    aria-pressed={f.days.includes(String(i))}
                    onClick={() => toggle("days", String(i))}
                  >
                    {d.slice(0, 2)}
                  </button>
                ))}
              </div>
            </FilterGroup>
          </>
        );
      case "connections":
        return (
          <>
            <FilterGroup
              title="Airports to connect through"
              hint="Match at least one. Leave clear for any airport."
            >
              {connections.length > 0 ? (
                <div className="grid grid-cols-2">
                  {connections.map((code) => (
                    <Choice
                      key={code}
                      checked={f.via.split(/[,\s]+/).includes(code)}
                      onChange={() => {
                        const values = f.via.split(/[,\s]+/).filter(Boolean);
                        change({
                          via: (values.includes(code)
                            ? values.filter((v) => v !== code)
                            : [...values, code]
                          ).join(", "),
                        });
                      }}
                    >
                      {code}
                    </Choice>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No connections in these results.
                </p>
              )}
            </FilterGroup>
            {field("avoid", "Avoid these airports", "text", "e.g. LHR, CDG")}
            <FilterGroup title="Time between flights">
              <div className="grid grid-cols-2 gap-3">
                {field("minLayover", "Minimum minutes")}
                {field("maxLayover", "Maximum minutes")}
              </div>
            </FilterGroup>
          </>
        );
      case "availability":
        return (
          <>
            {field("minSeats", "Minimum reported seats")}
            {check(
              "refundable",
              "Refundable awards only",
              "Only fares explicitly marked refundable.",
            )}
            {check("live", "Checked live only")}
            {field("maxAge", "Checked within (hours)")}
            <p className="text-xs text-muted-foreground leading-relaxed">
              Flights with unknown seats, refund terms or freshness are excluded
              when you require that information.
            </p>
          </>
        );
      case "details":
        return (
          <>
            {field(
              "text",
              "Find a flight or fare",
              "search",
              "e.g. AA2746 or Mint",
            )}
            {field("aircraft", "Aircraft", "text", "e.g. A350 or 787")}
            {field(
              "fare",
              "Fare name or booking class",
              "text",
              "e.g. Flex or J",
            )}
          </>
        );
    }
  };
  const label = (id: FilterSection) => {
    if (id === "cabin" && f.cabins.length)
      return f.cabins.length === 1
        ? CABIN_LABEL[f.cabins[0]]
        : `${f.cabins.length} cabins`;
    if (id === "stops" && f.maxStops !== "")
      return f.maxStops === "0"
        ? "Nonstop"
        : `≤${f.maxStops} stop${f.maxStops === "1" ? "" : "s"}`;
    if (id === "budget" && f.maxPoints)
      return `Up to ${compactPoints(f.maxPoints)} pts`;
    if (id === "budget" && f.maxFees)
      return `Fees ≤${f.maxFees} ${f.feeCurrency}`;
    if (id === "airlines" && f.airlines.length)
      return `${f.airlines.length} airline${f.airlines.length === 1 ? "" : "s"}`;
    if (id === "programs" && f.programs.length)
      return `${f.programs.length} program${f.programs.length === 1 ? "" : "s"}`;
    return sections.find((s) => s.id === id)!.name;
  };
  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  for (const section of sections) {
    for (const key of sectionKeys[section.id]) {
      if (!hasValue(f[key])) continue;
      const labels: Partial<Record<keyof ResultFilters, string>> = {
        text: `Find: ${f.text}`,
        maxPoints: `Points ≤${compactPoints(f.maxPoints)}`,
        maxFees: `Fees ≤${f.maxFees} ${f.feeCurrency}`,
        minValue: `Value ≥${f.minValue}¢ USD`,
        minSeats: `${f.minSeats}+ seats`,
        maxStops: f.maxStops === "0" ? "Nonstop" : `Up to ${f.maxStops} stops`,
        maxDuration: `Journey ≤${f.maxDuration}h`,
        minLayover: `Connection ≥${f.minLayover} min`,
        maxLayover: `Connection ≤${f.maxLayover} min`,
        departAfter: `Depart after ${time(f.departAfter)}`,
        departBefore: `Depart before ${time(f.departBefore)}`,
        arriveAfter: `Arrive after ${time(f.arriveAfter)}`,
        arriveBefore: `Arrive before ${time(f.arriveBefore)}`,
        via: `Via ${f.via}`,
        avoid: `Avoid ${f.avoid}`,
        aircraft: f.aircraft,
        fare: f.fare,
        transfer: f.transfer,
        mixed: "No mixed cabins",
        refundable: "Refundable",
        confirmedCabin: "Confirmed cabins",
        live: "Checked live",
        maxAge: `Checked within ${f.maxAge}h`,
        noOvernight: "Same-day arrival",
        walletOnly: "Within my balance",
      };
      if (Array.isArray(f[key])) {
        for (const v of f[key] as string[])
          activeChips.push({
            key: `${key}:${v}`,
            label:
              key === "cabins"
                ? CABIN_LABEL[v as keyof typeof CABIN_LABEL]
                : key === "programs"
                  ? programName(v)
                  : key === "days"
                    ? days[Number(v)]
                    : (airlines.find((a) => a.id === v)?.name ?? v),
            clear: () =>
              toggle(key as "cabins" | "airlines" | "programs" | "days", v),
          });
      } else
        activeChips.push({
          key,
          label: labels[key] ?? key,
          clear: () => change({ [key]: defaultFilters()[key] }),
        });
    }
  }
  return (
    <div className="result-filters">
      <div className="filter-toolbar" aria-label="Filter flights">
        {sections.slice(0, 6).map(({ id, icon: Icon }) => {
          const trigger = (
            <Button
              type="button"
              variant="outline"
              className="filter-trigger"
              data-active={sectionCount(id) > 0}
              onClick={compact ? () => setSheet(id) : undefined}
            >
              <Icon />
              <span>{label(id)}</span>
              {sectionCount(id) > 0 ? (
                <span
                  className="filter-active-dot"
                  aria-label="Filter active"
                />
              ) : (
                <ChevronDown className="filter-chevron" />
              )}
            </Button>
          );
          return compact ? (
            <span key={id}>{trigger}</span>
          ) : (
            <Popover
              key={id}
              open={popover === id}
              onOpenChange={(open) => setPopover(open ? id : null)}
            >
              <PopoverTrigger asChild>{trigger}</PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={8}
                className="filter-popover"
              >
                <div className="filter-popover-body">{content(id)}</div>
                <div className="filter-panel-footer">
                  <Button
                    variant="ghost"
                    onClick={() => clearSection(id)}
                    disabled={!sectionCount(id)}
                  >
                    Reset
                  </Button>
                  <Button onClick={() => setPopover(null)}>Done</Button>
                </div>
              </PopoverContent>
            </Popover>
          );
        })}
        <Button
          type="button"
          variant="outline"
          className="filter-trigger filter-all-trigger"
          onClick={() => setSheet("all")}
        >
          <SlidersHorizontal />
          All filters
          {count > 0 && <span className="filter-count">{count}</span>}
        </Button>
      </div>
      {activeChips.length > 0 && (
        <div className="filter-active-row" aria-label="Active filters">
          {activeChips.map((chip) => (
            <button
              type="button"
              key={chip.key}
              onClick={chip.clear}
              aria-label={`Remove ${chip.label}`}
              className="filter-active-chip"
            >
              <span>{chip.label}</span>
              <X size={13} />
            </button>
          ))}
          <button type="button" className="filter-clear" onClick={reset}>
            Clear all
          </button>
        </div>
      )}
      <Dialog
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) setSheet(null);
        }}
      >
        <DialogContent className="filter-sheet">
          <div className="filter-sheet-heading">
            {sheet !== "all" && (
              <button
                type="button"
                className="filter-back"
                onClick={() => setSheet("all")}
              >
                <ArrowLeft size={16} />
                All filters
              </button>
            )}
            <DialogTitle>
              {sheet === "all"
                ? "Find your kind of flight"
                : (sections.find((s) => s.id === sheet)?.name ?? "Filters")}
            </DialogTitle>
            <DialogDescription>
              {sheet === "all"
                ? "Start with what matters to you."
                : sections.find((s) => s.id === sheet)?.hint}
            </DialogDescription>
          </div>
          <div className="filter-sheet-body">
            {sheet === "all" ? (
              <>
                <div className="filter-section-list">
                  {sections.map(({ id, name, hint, icon: Icon }) => (
                    <button type="button" key={id} onClick={() => setSheet(id)}>
                      <span className="filter-section-icon">
                        <Icon size={19} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <strong>{name}</strong>
                        <small>{hint}</small>
                      </span>
                      {sectionCount(id) > 0 && (
                        <span className="filter-count">{sectionCount(id)}</span>
                      )}
                      <ChevronRight size={17} />
                    </button>
                  ))}
                </div>
                <FilterPresets filters={f} onApply={onChange} />
                <DisplayPreferences />
              </>
            ) : (
              sheet && content(sheet)
            )}
          </div>
          <div className="filter-sheet-footer">
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                onClick={
                  sheet === "all" ? reset : () => sheet && clearSection(sheet)
                }
                disabled={
                  sheet === "all" ? !count : !sheet || !sectionCount(sheet)
                }
              >
                Reset{sheet === "all" ? " all" : ""}
              </Button>
              <Button
                className="h-11 rounded-full px-6"
                onClick={() => setSheet(null)}
              >
                Show {matchingCount} flight{matchingCount === 1 ? "" : "s"}
                <ArrowRight size={16} />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
