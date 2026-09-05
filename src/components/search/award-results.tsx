"use client";
import { useState, useMemo, useEffect } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plane,
  Clock3,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PROGRAMS } from "@/lib/programs";
import { CABIN_ORDER, CABIN_LABEL, type Cabin } from "@/lib/types";
import type {
  AwardResult,
  AwardPrice,
  Coverage,
} from "@/lib/award-search/types";
import type { WalletData } from "@/lib/wallet";
export const programName = (id: string) =>
  PROGRAMS.find((p) => p.id === id)?.name ?? id;
const time = (s: string | null) => (s ? s.slice(11, 16) : "—");
const duration = (n: number | null) =>
  n === null ? "Schedule on airline" : `${Math.floor(n / 60)}h ${n % 60}m`;
const points = (n: number) => new Intl.NumberFormat("en-US").format(n);
export function cashLabel(p: AwardPrice, multiplier = 1) {
  if (p.cash === null || !p.currency) return "Fees not reported";
  try {
    return `${new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency, maximumFractionDigits: 2 }).format(p.cash * multiplier)} ${p.currency}`;
  } catch {
    return `${(p.cash * multiplier).toFixed(2)} ${p.currency}`;
  }
}
function Price({
  price,
  onClick,
}: {
  price?: AwardPrice;
  onClick: () => void;
}) {
  if (!price) return <span className="text-muted-foreground/50 px-3">—</span>;
  return (
    <button
      onClick={onClick}
      className={`award-price ${price.cabin === "J" ? "award-price-business" : ""} ${price.cabin === "F" ? "award-price-first" : ""}`}
      aria-label={`${CABIN_LABEL[price.cabin]} ${points(price.points)} points, ${cashLabel(price)}. View details.`}
    >
      <strong className="tabular-nums text-base">{points(price.points)}</strong>
      <span className="text-xs opacity-75 mt-1">
        {price.cash !== null ? "+ " : ""}
        {cashLabel(price)}
      </span>
      {price.mixedCabin && <span className="text-xs mt-1">Mixed cabin</span>}
    </button>
  );
}
export function AwardResults({
  rows,
  pax,
  coverage,
  loading,
  minCabin,
}: {
  rows: AwardResult[];
  pax: number;
  coverage: Coverage[];
  loading: boolean;
  minCabin: Cabin;
}) {
  const [selected, setSelected] = useState<{
    row: AwardResult;
    cabin: Cabin;
  } | null>(null);
  const [sort, setSort] = useState("points");
  const [cabin, setCabin] = useState<Cabin>(minCabin);
  const [nonstop, setNonstop] = useState(false);
  const [filter, setFilter] = useState("");
  const [program, setProgram] = useState("all");
  const [wallet, setWallet] = useState<WalletData | null>(null);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/wallet", { signal: c.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setWallet)
      .catch(() => {});
    return () => c.abort();
  }, []);
  const visible = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            (program === "all" || r.programId === program) &&
            (!nonstop || (r.kind === "flight" && r.segments.length === 1)) &&
            `${programName(r.programId)} ${r.segments.map((s) => s.flightNumber).join(" ")}`
              .toLowerCase()
              .includes(filter.toLowerCase()),
        )
        .sort((a, b) => {
          if (sort === "duration")
            return (a.duration ?? Infinity) - (b.duration ?? Infinity);
          if (sort === "depart")
            return (a.segments[0]?.departure ?? "z").localeCompare(
              b.segments[0]?.departure ?? "z",
            );
          const ac = a.prices[cabin]?.points ?? Infinity,
            bc = b.prices[cabin]?.points ?? Infinity;
          return ac - bc || a.id.localeCompare(b.id);
        }),
    [rows, nonstop, filter, program, sort, cabin],
  );
  const success = coverage.filter(
    (c) => c.state === "success" || c.state === "empty",
  ).length;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">AWARD AVAILABILITY</p>
          <h2 className="text-xl font-semibold mt-1">
            {rows.length
              ? `${visible.length} ways to go`
              : loading
                ? "Checking your options…"
                : "Your results"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Prices per person, one way. {success} programs checked
            {loading ? " so far." : "."}
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
          {pax} passenger{pax > 1 ? "s" : ""} · available cabins shown
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
        <SlidersHorizontal
          className="size-4 text-muted-foreground mr-1"
          aria-hidden
        />
        <label className="sr-only" htmlFor="result-filter">
          Filter by airline or flight
        </label>
        <Input
          id="result-filter"
          placeholder="Airline or flight number"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full sm:w-52"
        />
        <label className="sr-only" htmlFor="program-filter">
          Ticketing program
        </label>
        <select
          id="program-filter"
          className="result-select"
          value={program}
          onChange={(e) => setProgram(e.target.value)}
        >
          <option value="all">All programs</option>
          {[...new Set(rows.map((r) => r.programId))].map((id) => (
            <option key={id} value={id}>
              {programName(id)}
            </option>
          ))}
        </select>
        <Button
          variant={nonstop ? "secondary" : "outline"}
          onClick={() => setNonstop(!nonstop)}
          aria-pressed={nonstop}
        >
          Nonstop
        </Button>
        <div className="flex items-center gap-2 sm:ml-auto">
          <label
            className="text-sm text-muted-foreground"
            htmlFor="result-sort"
          >
            Sort
          </label>
          <select
            id="result-sort"
            className="result-select"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="points">Fewest points</option>
            <option value="duration">Shortest journey</option>
            <option value="depart">Departure time</option>
          </select>
          {sort === "points" && (
            <select
              aria-label="Cabin to sort by"
              className="result-select"
              value={cabin}
              onChange={(e) => setCabin(e.target.value as Cabin)}
            >
              {CABIN_ORDER.map((c) => (
                <option key={c} value={c}>
                  {CABIN_LABEL[c]}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="md:hidden divide-y">
          {visible.map((r) => (
            <article key={r.id} className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <span className="airline-tile">
                  {PROGRAMS.find((p) => p.id === r.programId)?.iata ?? "✈"}
                </span>
                <div>
                  <h3 className="font-semibold">{programName(r.programId)}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {r.kind === "calendar"
                      ? "Daily award calendar"
                      : r.segments.map((s) => s.flightNumber).join(" · ")}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium tabular-nums">
                  {r.kind === "calendar"
                    ? `${r.origin} → ${r.destination}`
                    : `${time(r.segments[0]?.departure)} → ${time(r.segments.at(-1)?.arrival ?? null)}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.kind === "calendar"
                    ? "Choose flight on airline"
                    : `${duration(r.duration)} · ${r.segments.length === 1 ? "Nonstop" : `${r.segments.length - 1} stops`}`}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {CABIN_ORDER.filter((c) => r.prices[c]).map((c) => (
                  <div key={c}>
                    <p className="text-xs text-muted-foreground mb-1.5">
                      {CABIN_LABEL[c]}
                    </p>
                    <Price
                      price={r.prices[c]}
                      onClick={() => setSelected({ row: r, cabin: c })}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {r.freshness === "live"
                  ? "Checked live"
                  : "Previously observed"}{" "}
                · {r.source}
                {r.kind === "flight" ? " · Local airport times" : ""}
              </p>
            </article>
          ))}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-muted-foreground">
                <th className="text-left px-5 py-4 font-medium min-w-64">
                  Flight & program
                </th>
                <th className="text-left py-4 px-3 font-medium">Journey</th>
                {CABIN_ORDER.map((c) => (
                  <th key={c} className="py-4 px-3 text-left font-medium">
                    {CABIN_LABEL[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-5 py-5">
                    <div className="flex items-center gap-3">
                      <span className="airline-tile">
                        {PROGRAMS.find((p) => p.id === r.programId)?.iata ??
                          "✈"}
                      </span>
                      <div>
                        <p className="font-semibold">
                          {programName(r.programId)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {r.kind === "calendar"
                            ? "Daily award calendar"
                            : r.segments.map((s) => s.flightNumber).join(" · ")}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 ml-[52px]">
                      <span
                        className={`inline-block size-1.5 rounded-full mr-1.5 ${r.freshness === "live" ? "bg-emerald-500" : "bg-amber-500"}`}
                      />
                      {r.freshness === "live"
                        ? "Checked live"
                        : "Previously observed"}{" "}
                      · {r.source}
                    </p>
                  </td>
                  <td className="px-3 py-4">
                    <p className="font-medium tabular-nums whitespace-nowrap">
                      {r.kind === "calendar"
                        ? `${r.origin} → ${r.destination}`
                        : `${time(r.segments[0]?.departure)} → ${time(r.segments.at(-1)?.arrival ?? null)}`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {r.kind === "calendar"
                        ? "Choose flight on airline"
                        : `${duration(r.duration)} · ${r.segments.length === 1 ? "Nonstop" : `${r.segments.length - 1} stop${r.segments.length > 2 ? "s" : ""}`}`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {r.kind === "flight"
                        ? "Local airport times"
                        : "Exact flight not supplied"}
                    </p>
                  </td>
                  {CABIN_ORDER.map((c) => (
                    <td key={c} className="px-2 py-3 align-middle">
                      <Price
                        price={r.prices[c]}
                        onClick={() => setSelected({ row: r, cabin: c })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && !rows.length && (
          <div className="p-8 space-y-4" role="status">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-16 rounded-lg bg-muted animate-pulse motion-reduce:animate-none"
              />
            ))}
            <p className="text-sm text-muted-foreground">
              Checking award prices directly with connected sources…
            </p>
          </div>
        )}
        {!loading && !visible.length && (
          <div className="p-10 text-center space-y-3">
            <Plane className="size-7 mx-auto text-muted-foreground" />
            <p className="font-medium">
              {rows.length
                ? "No results match these filters."
                : "No award results returned for this search."}
            </p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {rows.length
                ? "Try another cabin or remove a filter."
                : "Try nearby airports or another date. Check program coverage below to see which sources responded."}
            </p>
            {rows.length > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  setFilter("");
                  setProgram("all");
                  setNonstop(false);
                }}
              >
                <X className="size-4" />
                Reset filters
              </Button>
            )}
          </div>
        )}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {selected && (
            <Details
              row={selected.row}
              cabin={selected.cabin}
              pax={pax}
              wallet={wallet}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function Details({
  row,
  cabin,
  pax,
  wallet,
}: {
  row: AwardResult;
  cabin: Cabin;
  pax: number;
  wallet: WalletData | null;
}) {
  const [copied, setCopied] = useState(false);
  const price = row.prices[cabin]!;
  const balance = wallet?.entries.find(
    (e) => e.asset_id === row.programId,
  )?.balance;
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{programName(row.programId)}</p>
        <DialogTitle className="text-2xl mt-2">
          {row.origin} <ArrowRight className="inline size-5 mx-2" />
          {row.destination}
        </DialogTitle>
        <DialogDescription className="mt-2">
          {row.date} · {CABIN_LABEL[cabin]} · {pax} passenger
          {pax > 1 ? "s" : ""} · one way
        </DialogDescription>
      </div>
      <div className="rounded-xl bg-muted/50 p-5 grid gap-4 grid-cols-2">
        <div>
          <p className="text-sm text-muted-foreground">Points for your party</p>
          <p className="text-2xl font-semibold mt-1 tabular-nums">
            {points(price.points * pax)}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">
            Taxes & fees for your party
          </p>
          <p className="text-xl font-semibold mt-1">{cashLabel(price, pax)}</p>
        </div>
      </div>
      {price.mixedCabin && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Mixed cabin: part of this journey is in a lower cabin. Check each
          segment before booking.
        </p>
      )}
      {row.kind === "calendar" ? (
        <p className="text-muted-foreground">
          This is the airline’s lowest reported daily award price. The source
          does not supply a flight number or schedule. Choose your specific
          flight on the airline website.
        </p>
      ) : (
        <ol className="space-y-4">
          {row.segments.map((s, i) => (
            <li key={i} className="border-l-2 border-primary/30 pl-4">
              <p className="font-medium">
                {s.origin} → {s.destination}
                <span className="ml-3 text-sm text-muted-foreground">
                  {s.flightNumber}
                </span>
              </p>
              <p className="text-sm mt-1">
                {time(s.departure)} – {time(s.arrival)} ·{" "}
                {s.departure?.slice(0, 10)}
                {s.arrival?.slice(0, 10) !== s.departure?.slice(0, 10)
                  ? ` → ${s.arrival?.slice(0, 10)}`
                  : ""}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {s.aircraft ?? "Aircraft not reported"}
                {s.cabin ? ` · ${CABIN_LABEL[s.cabin]}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
      <div className="text-sm text-muted-foreground space-y-2">
        <p>
          <Clock3 className="inline size-4 mr-2" />
          {row.kind === "flight"
            ? duration(row.duration)
            : "Calendar availability"}{" "}
          ·{" "}
          {price.seats === null
            ? "Seat count not reported"
            : `${price.seats} seat${price.seats === 1 ? "" : "s"} reported`}
        </p>
        <p>
          Observed {new Date(row.observedAt).toLocaleString()} through{" "}
          {row.source}.
        </p>
        {balance !== undefined && (
          <p className="text-foreground font-medium">
            Your wallet: {points(balance)} points.{" "}
            {balance >= price.points * pax
              ? "Enough points for this award."
              : `${points(price.points * pax - balance)} more points needed.`}
          </p>
        )}
        <p>
          Availability can change. Confirm seats and the final price with the
          airline before transferring points.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild className="h-11 flex-1">
          <a href={row.bookingUrl} target="_blank" rel="noopener noreferrer">
            Continue with airline <ArrowUpRight className="size-4" />
          </a>
        </Button>
        <Button
          variant="outline"
          className="h-11"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `${programName(row.programId)}: ${row.origin} to ${row.destination}, ${row.date}, ${CABIN_LABEL[cabin]}, ${pax} passengers. ${points(price.points * pax)} points + ${cashLabel(price, pax)}. Flights: ${row.segments.map((s) => s.flightNumber).join(", ") || "choose on airline"}. ${row.bookingUrl}`,
              );
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy trip details"}
        </Button>
      </div>
    </div>
  );
}
