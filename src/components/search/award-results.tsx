"use client";
import { useState, useMemo, useEffect, Fragment } from "react";
import { ArrowUpRight, Plane, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DisplayCurrencyProvider,
  useDisplayCurrency,
  Money,
} from "./display-currency";
import { PointsGuide } from "@/components/points/points-guide";
import { useSessionPoints } from "@/hooks/use-session-points";
import { SaveFlight } from "@/components/trips/save-flight";
import { flexibilityInsight } from "@/lib/award-search/flexibility";
import { BookingInspector } from "./booking-inspector";
import { placeName } from "@/lib/search-places";
import { useCompactResults } from "./result-density";
import { useTimeFormat } from "./time-preference";
import { ResultFilterBar } from "./result-filters";
import {
  defaultFilters,
  groupFlights,
  filterGroups,
  sortGroups,
  compareOffers,
  lowestFareForDate,
  activeSortCabin,
  type FlightGroup,
  type SortOrder,
} from "@/lib/award-search/comparison";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AIRLINES } from "@/db/seed/airlines";
import { programName } from "@/lib/programs";
import { CABIN_ORDER, CABIN_LABEL, type Cabin } from "@/lib/types";
import type {
  AwardResult,
  AwardPrice,
  Coverage,
} from "@/lib/award-search/types";
import { availableWalletBalance, type WalletData } from "@/lib/wallet";
import { centsPerPoint, pointsForParty } from "@/lib/award-search/value";
import { stopSummary } from "@/lib/award-search/stops";
import { bookingUrl } from "@/lib/bookingHandoff";
export { programName } from "@/lib/programs";
const airlines = (row: AwardResult) =>
  [
    ...new Set(
      row.segments
        .map(
          (s) =>
            s.airlineName ??
            AIRLINES.find((a) => a.iata === s.airline)?.name ??
            s.airline,
        )
        .filter(Boolean),
    ),
  ].join(" + ");
const surfaceTravel = (row: AwardResult) =>
  row.segments.some((s) => /\bTRAIN\b/i.test(s.aircraft ?? ""))
    ? "Includes rail travel"
    : row.segments.some((s) => /\b(?:BUS|COACH)\b/i.test(s.aircraft ?? ""))
      ? "Includes coach travel"
      : null;
const duration = (n: number | null) =>
  n === null ? "Schedule on airline" : `${Math.floor(n / 60)}h ${n % 60}m`;
const points = (n: number) => new Intl.NumberFormat("en-US").format(n);
export function cashLabel(
  p: Pick<AwardPrice, "cash" | "currency" | "feesIncludedInPoints">,
  multiplier = 1,
) {
  if (p.feesIncludedInPoints) return "Taxes included in miles";
  if (p.cash === null || !p.currency) return "Fees not reported";
  try {
    return `${new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency, maximumFractionDigits: 2 }).format(p.cash * multiplier)} ${p.currency}`;
  } catch {
    return `${(p.cash * multiplier).toFixed(2)} ${p.currency}`;
  }
}
export function AwardResults(props: Parameters<typeof Results>[0]) {
  return (
    <DisplayCurrencyProvider>
      <Results {...props} />
    </DisplayCurrencyProvider>
  );
}
function Results({
  rows: allRows,
  pax,
  loading,
  dates = [],
  dayStatus = [],
  requestedDate,
  minCabin,
}: {
  rows: AwardResult[];
  pax: number;
  coverage: Coverage[];
  loading: boolean;
  minCabin: Cabin;
  dates?: string[];
  requestedDate?: string;
  dayStatus?: { date: string; state: string; message?: string }[];
}) {
  const fx = useDisplayCurrency();
  const sessionPoints = useSessionPoints();
  const { time } = useTimeFormat();
  const [compact] = useCompactResults();
  const groups = useMemo(() => groupFlights(allRows), [allRows]);
  const calendars = useMemo(
    () => allRows.filter((r) => r.kind === "calendar"),
    [allRows],
  );
  const [filters, setFilters] = useState(() => ({
    ...defaultFilters(),
    cabins:
      minCabin === "Y" ? [] : CABIN_ORDER.slice(CABIN_ORDER.indexOf(minCabin)),
  }));
  const [sort, setSort] = useState<SortOrder>("points"),
    [descending, setDescending] = useState(false),
    [requestedSortCabin, setSortCabin] = useState<Cabin | null>(null);
  const sortCabin = activeSortCabin(filters.cabins, requestedSortCabin);
  const [selected, setSelected] = useState<{ id: string; cabin: Cabin } | null>(
      null,
    ),
    [detail, setDetail] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null),
    [day, setDay] = useState("all"),
    [page, setPage] = useState(0),
    [pageSize, setPageSize] = useState(25),
    [party, setParty] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/wallet", { signal: c.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setWallet)
      .catch(() => {});
    return () => c.abort();
  }, []);
  const balances = useMemo(
    () => ({
      ...Object.fromEntries(
        wallet?.entries.map((e) => [
          e.asset_id,
          availableWalletBalance(wallet, e.asset_id) ?? 0,
        ]) ?? [],
      ),
      ...sessionPoints.balances,
    }),
    [wallet, sessionPoints.balances],
  );
  const matching = useMemo(
    () =>
      filterGroups(
        groups,
        { ...filters, feeCurrency: fx.currency },
        pax,
        balances,
        fx.now,
        fx.rates,
      ),
    [groups, filters, pax, balances, fx.currency, fx.rates, fx.now],
  );
  const visible = useMemo(
    () =>
      sortGroups(
        matching.filter((g) => day === "all" || g.row.date === day),
        sort,
        fx.currency,
        descending,
        sortCabin,
        fx.rates,
      ),
    [matching, day, sort, fx.currency, fx.rates, descending, sortCabin],
  );
  const shownCabins = filters.cabins.length
    ? CABIN_ORDER.filter((c) => filters.cabins.includes(c))
    : CABIN_ORDER;
  const flexibility = requestedDate
    ? flexibilityInsight(matching, requestedDate, pax, party)
    : null;
  const currentPage = Math.min(
      page,
      Math.max(0, Math.ceil(visible.length / pageSize) - 1),
    ),
    shown = visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selectedGroup = visible.find((g) => g.id === selected?.id),
    selectedOffers =
      selectedGroup?.offers.filter((o) => o.price.cabin === selected?.cabin) ??
      [];
  const detailedRow = (
    selectedOffers.find((o) => `${o.row.programId}:${o.row.id}` === detail) ??
    [...selectedOffers].sort((a, b) => compareOffers(a, b, "points"))[0]
  )?.row;
  const checked = new Set(groups.flatMap((g) => g.programs)).size;
  function changeSort(next: SortOrder, cabin: Cabin | null = null) {
    if (sort === next && sortCabin === cabin) setDescending(!descending);
    else {
      setSort(next);
      setSortCabin(cabin);
      setDescending(["value", "freshness", "programs"].includes(next));
    }
    setPage(0);
  }
  const header = (
    label: string,
    key: SortOrder,
    cabin: Cabin | null = null,
  ) => (
    <th
      scope="col"
      className="px-3 py-3 text-left font-normal"
      aria-sort={
        sort === key && sortCabin === cabin
          ? descending
            ? "descending"
            : "ascending"
          : "none"
      }
    >
      <button
        className="min-h-10 flex items-center gap-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 disabled:cursor-default"
        disabled={
          !!cabin &&
          filters.cabins.length > 0 &&
          !filters.cabins.includes(cabin)
        }
        onClick={() => changeSort(key, cabin)}
      >
        {label}
        <span aria-hidden>
          {sort === key && sortCabin === cabin ? (descending ? "↓" : "↑") : "↕"}
        </span>
      </button>
    </th>
  );
  function open(g: FlightGroup, c: Cabin) {
    setSelected({ id: g.id, cabin: c });
    const ids = [
      ...new Set(
        g.offers.filter((o) => o.price.cabin === c).map((o) => o.row.id),
      ),
    ];
    setDetail(ids.length === 1 ? ids[0] : null);
  }
  const best = (g: FlightGroup, c: Cabin) =>
    [...g.offers]
      .filter((o) => o.price.cabin === c)
      .sort((a, b) => compareOffers(a, b, "points"))[0];
  const cell = (g: FlightGroup, c: Cabin) => {
    const offer = best(g, c);
    if (!offer) return <span className="text-muted-foreground/50">—</span>;
    const n = new Set(
      g.offers.filter((o) => o.price.cabin === c).map((o) => o.row.programId),
    ).size;
    return (
      <button
        onClick={() => open(g, c)}
        className={`award-price ${c === "J" ? "award-price-business" : c === "F" ? "award-price-first" : ""}`}
        aria-label={`Compare ${CABIN_LABEL[c]} on ${g.row.segments.map((s) => s.flightNumber).join(", ")}, from ${points(party ? pointsForParty(offer.price, pax) : offer.price.points)} points`}
      >
        <strong className="tabular-nums">
          {points(
            party ? pointsForParty(offer.price, pax) : offer.price.points,
          )}
        </strong>
        <span className="text-xs mt-1">
          <Money price={offer.price} multiplier={party ? pax : 1} />
        </span>
        <span className="price-program text-[11px] text-muted-foreground mt-1">
          {n > 1 ? `${n} programs` : programName(offer.row.programId)}
        </span>
        {offer.row.freshness === "cached" && (
          <span className="text-[11px] text-muted-foreground mt-1">
            Cached · recheck
          </span>
        )}
        {offer.price.eligibility && (
          <span
            className="text-[11px] mt-1 text-amber-700 dark:text-amber-300"
            title={offer.price.eligibility.description}
          >
            {offer.price.eligibility.label}
          </span>
        )}
        {!offer.price.eligibility && !!offer.price.bookingNotes?.length && (
          <span className="text-[11px] mt-1">Fare conditions</span>
        )}
        {offer.price.mixedCabin && (
          <span className="text-xs mt-1">Mixed cabin</span>
        )}
        {centsPerPoint(offer.price) !== null && (
          <span className="price-value text-xs mt-1">
            {centsPerPoint(offer.price)!.toFixed(2)}¢ USD / point
          </span>
        )}
      </button>
    );
  };
  return (
    <section
      className="award-results space-y-4"
      data-density={compact ? "compact" : "comfortable"}
    >
      <div className="flex flex-wrap justify-between gap-3 items-end">
        <div>
          <h2 className="text-2xl font-semibold mt-1">
            {groups.length
              ? `${visible.length} flight itinerar${visible.length === 1 ? "y" : "ies"}`
              : loading
                ? "Checking your options…"
                : "Your results"}
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            {visible.reduce((n, g) => n + g.offers.length, 0)} fare choices ·{" "}
            {checked} flight source{checked === 1 ? "" : "s"} with results
          </p>
        </div>
        <div className="flex items-center gap-4">
          {pax > 1 && (
            <label className="flex items-center gap-2 text-sm min-h-11">
              <input
                type="checkbox"
                className="accent-primary"
                checked={party}
                onChange={(e) => setParty(e.target.checked)}
              />
              Show totals for {pax} adult{pax > 1 ? "s" : ""}
            </label>
          )}
        </div>
      </div>
      {matching.some((g) => g.offers.some((o) => o.price.eligibility)) && (
        <p className="text-sm text-muted-foreground">
          Member pricing is marked on each fare. Your account may receive a
          different price.
        </p>
      )}
      <ResultFilterBar
        value={{ ...filters, feeCurrency: fx.currency }}
        onChange={(f) => {
          setFilters(f);
          setPage(0);
        }}
        groups={groups}
        walletAvailable={Object.keys(balances).length > 0}
        matchingCount={visible.length}
      />
      {dates.length > 1 && (
        <div className="date-window rounded-xl border bg-card p-3">
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className="text-sm font-medium">Your date window</span>
            <button
              onClick={() => {
                setDay("all");
                setPage(0);
              }}
              className={`text-xs rounded-full border px-3 py-2 ${day === "all" ? "border-primary text-primary" : ""}`}
            >
              All {dates.length} days
            </button>
          </div>
          <div className="date-window-days flex gap-2 overflow-x-auto pb-1">
            {dates.map((date) => {
              const lowest = lowestFareForDate(matching, date, pax, party);
              const status = dayStatus.find((d) => d.date === date);
              return (
                <button
                  key={date}
                  onClick={() => {
                    setDay(date);
                    setPage(0);
                  }}
                  aria-pressed={day === date}
                  className={`min-w-28 rounded-lg border p-3 text-left ${day === date ? "border-primary bg-primary/10" : "hover:bg-muted/40"}`}
                >
                  <span className="block text-xs text-muted-foreground">
                    {new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                  </span>
                  <strong className="block tabular-nums mt-2 text-sm">
                    {lowest !== null
                      ? `${points(lowest.points)} pts`
                      : status?.state === "complete"
                        ? "No matches returned"
                        : status?.state === "error"
                          ? "No matches returned"
                          : status?.state === "cancelled"
                            ? "Stopped"
                            : "Checking…"}
                  </strong>
                  <span className="block text-[10px] text-muted-foreground mt-1">
                    {lowest && (
                      <span className="block mb-1">
                        {CABIN_LABEL[lowest.cabin]}
                      </span>
                    )}
                    {status?.state === "complete"
                      ? "Connected sources checked"
                      : status?.state === "error"
                        ? "Incomplete coverage"
                        : (status?.state ?? "Queued")}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Lowest matching fare · {party ? "party total" : "per person"} before
            fees · current filters apply. Incomplete coverage means some sources
            could not be checked.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>
          {party ? `Totals for ${pax} adults` : "Prices per person"} · one way ·
          local airport times. Points from different programs have different
          values.
        </p>
        <div className="flex items-center gap-2">
          <label htmlFor="result-sort">Sort</label>
          <select
            id="result-sort"
            className="rounded-md border bg-background p-2 text-foreground"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortOrder);
              setSortCabin(null);
              setDescending(
                ["value", "freshness", "programs"].includes(e.target.value),
              );
              setPage(0);
            }}
          >
            {[
              ["points", "Fewest points"],
              ["fees", `Lowest fees (${fx.currency})`],
              ["value", "Best value (USD cents)"],
              ["duration", "Shortest journey"],
              ["depart", "Departure"],
              ["arrive", "Arrival"],
              ["stops", "Fewest stops"],
              ["freshness", "Freshest observation"],
              ["programs", "Most booking programs"],
            ].map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="rounded-md border p-2 min-w-10"
            aria-label={
              descending
                ? "Change to ascending sort"
                : "Change to descending sort"
            }
            onClick={() => setDescending(!descending)}
          >
            {descending ? "↓" : "↑"}
          </button>
        </div>
      </div>
      {flexibility && (
        <p className="flexibility-insight">
          <span>Flexibility found</span> {points(flexibility.saved)} fewer
          points {party ? "for your party" : "per person"} on{" "}
          {flexibility.alternative.row.date}, with{" "}
          {programName(flexibility.alternative.row.programId)} in{" "}
          {CABIN_LABEL[flexibility.alternative.price.cabin].toLowerCase()}.
          Compared with your requested date among matching fares; fees and
          conditions may differ.
        </p>
      )}
      <div
        className={`results-layout ${selectedGroup ? "inspector-open" : ""}`}
        data-cabin-count={shownCabins.length}
      >
        <div className="results-list space-y-4 min-w-0">
          <div className="results-table rounded-xl border bg-card overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="award-table w-full text-sm min-w-[1000px]">
                <caption className="sr-only">
                  Award itineraries with booking programs grouped together.
                  Click a column heading to sort, or a cabin price to compare
                  booking options.
                </caption>
                <thead className="text-xs text-muted-foreground border-b bg-muted/20">
                  <tr>
                    {header("Flight / programs", "programs")}
                    {header("Departs", "depart")}
                    {header("Arrives", "arrive")}
                    {header("Duration", "duration")}
                    {shownCabins.map((c) => (
                      <Fragment key={c}>
                        {header(CABIN_LABEL[c], "points", c)}
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {shown.map((g) => (
                    <tr
                      key={g.id}
                      className={`hover:bg-muted/10 ${selected?.id === g.id ? "selected-flight" : ""}`}
                    >
                      <td className="px-4 py-5 min-w-44">
                        <p className="font-medium">
                          {airlines(g.row) ||
                            g.row.segments.map((s) => s.airline).join(" + ")}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {g.row.segments
                            .map((s) => s.flightNumber)
                            .join(" · ")}
                        </p>
                        {surfaceTravel(g.row) && (
                          <p className="text-xs text-amber-600 dark:text-amber-300 mt-1">
                            {surfaceTravel(g.row)}
                          </p>
                        )}
                        <p className="booking-count text-xs text-primary mt-2">
                          {g.programs.length} booking program
                          {g.programs.length > 1 ? "s" : ""} · {g.offers.length}{" "}
                          fare{g.offers.length > 1 ? "s" : ""}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-medium tabular-nums">
                          {time(g.row.segments[0]?.departure)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {g.row.origin} · {g.row.date.slice(5)}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-medium tabular-nums">
                          {time(g.row.segments.at(-1)?.arrival ?? null)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {g.row.destination} ·{" "}
                          {g.row.segments.at(-1)?.arrival?.slice(5, 10) ?? "—"}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <p className="whitespace-nowrap">
                          {duration(g.row.duration)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {stopSummary(g.row)}
                        </p>
                      </td>
                      {shownCabins.map((c) => (
                        <td key={c} className="px-2 py-3">
                          {cell(g, c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flight-card-list grid gap-3 md:hidden">
            {shown.map((g) => (
              <article
                key={g.id}
                className={`flight-card rounded-xl border bg-card p-4 ${selected?.id === g.id ? "selected-flight" : ""}`}
              >
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {airlines(g.row) ||
                        g.row.segments.map((s) => s.airline).join(" + ")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {g.row.segments.map((s) => s.flightNumber).join(" · ")}
                    </p>
                  </div>
                  <span className="text-xs text-primary">
                    {g.programs.length} program
                    {g.programs.length > 1 ? "s" : ""}
                  </span>
                </div>
                {surfaceTravel(g.row) && (
                  <p className="text-xs text-amber-600 dark:text-amber-300 mt-2">
                    {surfaceTravel(g.row)}
                  </p>
                )}
                <p className="mt-4 text-lg tabular-nums">
                  {time(g.row.segments[0]?.departure)} →{" "}
                  {time(g.row.segments.at(-1)?.arrival ?? null)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {g.row.date} · {duration(g.row.duration)} ·{" "}
                  {stopSummary(g.row)}
                </p>
                <div className="flight-card-prices grid grid-cols-2 gap-2 mt-4">
                  {CABIN_ORDER.filter((c) => best(g, c)).map((c) => (
                    <div key={c}>
                      <p className="text-xs text-muted-foreground mb-1">
                        {CABIN_LABEL[c]}
                      </p>
                      {cell(g, c)}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {loading && !groups.length && (
            <div className="rounded-xl border p-8 space-y-4" role="status">
              <div className="h-20 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" />
              <p className="text-sm text-muted-foreground">
                Checking connected award sources. Flights appear as each source
                responds.
              </p>
            </div>
          )}
          {!loading && !visible.length && (
            <div className="rounded-xl border p-10 text-center space-y-3">
              <Plane className="size-7 mx-auto text-muted-foreground" />
              <p className="font-medium">
                {groups.length
                  ? "No fares match these filters."
                  : "No individual flights returned."}
              </p>
              <p className="text-sm text-muted-foreground">
                {groups.length
                  ? "Clear a filter or choose another date."
                  : "Check source coverage below. Unavailable programs have not confirmed an absence of seats."}
              </p>
              {groups.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilters(defaultFilters());
                    setDay("all");
                  }}
                >
                  Reset filters & dates
                </Button>
              )}
            </div>
          )}
          {visible.length > 0 && (
            <div className="flex flex-wrap justify-between items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {currentPage * pageSize + 1}–
                {Math.min((currentPage + 1) * pageSize, visible.length)} of{" "}
                {visible.length} itineraries. Every matching fare remains
                available.
              </span>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Itineraries per page"
                  className="rounded-md border bg-background p-2"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(0);
                  }}
                >
                  {[25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n} / page
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={(currentPage + 1) * pageSize >= visible.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
          {calendars.length > 0 && (
            <CalendarSummaries
              rows={calendars.filter((r) => day === "all" || r.date === day)}
              pax={pax}
            />
          )}
        </div>
        <BookingInspector
          open={!!selectedGroup}
          onClose={() => {
            setSelected(null);
            setDetail(null);
          }}
        >
          {selectedGroup && selected && detailedRow && (
            <div className="space-y-5">
              <div className="flight-ticket">
                <p className="eyebrow">YOUR SELECTED FLIGHT</p>
                <DialogTitle className="ticket-airline">
                  {airlines(selectedGroup.row)}
                </DialogTitle>
                <DialogDescription className="mt-2">
                  {CABIN_LABEL[selected.cabin]} ·{" "}
                  {stopSummary(selectedGroup.row)} ·{" "}
                  {selectedGroup.row.segments
                    .map((s) => s.flightNumber)
                    .join(" + ")}
                </DialogDescription>
                <div className="ticket-route">
                  <div>
                    <strong>{selectedGroup.row.origin}</strong>
                    <span>{placeName(selectedGroup.row.origin)}</span>
                  </div>
                  <div className="ticket-route-line">
                    <Plane className="size-5" />
                  </div>
                  <div>
                    <strong>{selectedGroup.row.destination}</strong>
                    <span>{placeName(selectedGroup.row.destination)}</span>
                  </div>
                </div>
                <div className="ticket-schedule">
                  <div>
                    <strong>
                      {time(selectedGroup.row.segments[0]?.departure)}
                    </strong>
                    <span>{selectedGroup.row.date}</span>
                  </div>
                  <div>
                    <strong>
                      {time(selectedGroup.row.segments.at(-1)?.arrival ?? null)}
                    </strong>
                    <span>
                      {selectedGroup.row.segments
                        .at(-1)
                        ?.arrival?.slice(0, 10) ?? "Arrival date not reported"}
                    </span>
                  </div>
                </div>
              </div>
              <fieldset className="booking-programs">
                <legend className="text-lg font-semibold">
                  Choose how to book
                </legend>
                <p className="text-sm text-muted-foreground mb-3 mt-1">
                  Same flight. Different points programs.
                </p>
                {[
                  ...new Set(
                    selectedOffers.map((o) => `${o.row.programId}:${o.row.id}`),
                  ),
                ].map((id) => {
                  const offers = selectedOffers
                    .filter((o) => `${o.row.programId}:${o.row.id}` === id)
                    .sort((a, b) => compareOffers(a, b, "points"));
                  const first = offers[0];
                  const checked =
                    `${detailedRow.programId}:${detailedRow.id}` === id;
                  return (
                    <label
                      key={id}
                      className={`program-choice ${checked ? "is-selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="booking-program"
                        checked={checked}
                        onChange={() => setDetail(id)}
                      />
                      <span>
                        <strong>{programName(first.row.programId)}</strong>
                        <small>
                          {offers.length} fare{offers.length > 1 ? "s" : ""}
                          {first.price.eligibility
                            ? ` · ${first.price.eligibility.label}`
                            : ""}
                        </small>
                      </span>
                      <span className="program-quote">
                        {offers.length > 1 && <small>From</small>}
                        <strong>
                          {points(
                            party
                              ? pointsForParty(first.price, pax)
                              : first.price.points,
                          )}
                        </strong>
                        <small>
                          +{" "}
                          <Money
                            price={first.price}
                            multiplier={party ? pax : 1}
                          />
                        </small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <Details
                key={`${detailedRow.programId}:${detailedRow.id}:${selected.cabin}`}
                row={{
                  ...detailedRow,
                  fares: selectedOffers
                    .filter((o) => o.row === detailedRow)
                    .map((o) => o.price),
                  prices: {
                    [selected.cabin]: selectedOffers
                      .filter((o) => o.row === detailedRow)
                      .sort((a, b) => compareOffers(a, b, "points"))[0]?.price,
                  },
                }}
                cabin={selected.cabin}
                pax={pax}
                wallet={wallet}
              />
            </div>
          )}
        </BookingInspector>
      </div>
    </section>
  );
}

function CalendarSummaries({
  rows,
  pax,
}: {
  rows: AwardResult[];
  pax: number;
}) {
  return (
    <section
      aria-labelledby="calendar-summary-heading"
      className="rounded-xl border bg-card p-5 space-y-4"
    >
      <div>
        <p className="eyebrow">DAILY FARE SUMMARIES</p>
        <h3
          id="calendar-summary-heading"
          className="text-lg font-semibold mt-1"
        >
          A starting point for your search
        </h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
          These calendars report daily prices, not every flight. Departure
          times, connections and fare choices are not supplied. Confirm
          availability with the airline.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((row) => {
          const quotes = row.calendarQuote
            ? [{ ...row.calendarQuote, label: "Cabin not reported" }]
            : CABIN_ORDER.flatMap((c) =>
                row.prices[c]
                  ? [{ ...row.prices[c]!, label: CABIN_LABEL[c] }]
                  : [],
              );
          return (
            <article key={row.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="font-medium">{programName(row.programId)}</h4>
                <span className="text-xs text-muted-foreground">
                  {row.origin} → {row.destination}
                </span>
              </div>
              <dl className="space-y-3">
                {quotes.map((quote) => (
                  <div
                    key={quote.label}
                    className="flex items-start justify-between gap-4 text-sm"
                  >
                    <dt className="text-muted-foreground">{quote.label}</dt>
                    <dd className="text-right">
                      <strong className="font-medium tabular-nums">
                        From {points(quote.points)} points
                      </strong>
                      <p className="text-xs text-muted-foreground mt-1">
                        {quote.cash !== null ? "+ " : ""}
                        <Money price={quote} /> · per person
                      </p>
                      {pax > 1 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {points(quote.points * pax)} points +{" "}
                          <Money price={quote} multiplier={pax} /> for {pax}
                        </p>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">
                {row.programId === "B6_TRUEBLUE"
                  ? "Lowest recent fare; cabin and exact flight are unknown."
                  : "Calendar availability; fees and exact flights are not reported."}
              </p>
              <a
                href={row.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                Choose a flight on the airline{" "}
                <ArrowUpRight className="size-4" />
              </a>
            </article>
          );
        })}
      </div>
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
  const { time, format: timeFormat } = useTimeFormat();
  const [copied, setCopied] = useState(false);
  const options = row.fares?.filter((p) => p.cabin === cabin) ?? [];
  const [fareIndex, setFareIndex] = useState(() =>
    Math.max(0, options.indexOf(row.prices[cabin]!)),
  );
  const price = options[fareIndex] ?? row.prices[cabin]!;
  const continueUrl = ["ET_SHEBAMILES", "EY_GUEST"].includes(row.programId)
    ? bookingUrl(row.programId, {
        origin: row.origin,
        dest: row.destination,
        departDate: row.date,
        pax,
        minCabin: price.cabin,
      })
    : row.bookingUrl;
  const value = centsPerPoint(price);
  const balance = availableWalletBalance(wallet, row.programId);
  return (
    <div className="space-y-6">
      {options.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-2">
            {options.length === 1 ? "Award fare" : "Choose an award fare"}
          </legend>
          {options.map((option, index) => (
            <label
              key={`${option.fareId ?? "fare"}:${index}`}
              className={`flex items-center gap-3 rounded-lg border p-3 min-h-11 cursor-pointer ${price === option ? "border-primary/50 bg-primary/5" : ""}`}
            >
              <input
                type="radio"
                name="award-fare"
                checked={price === option}
                onChange={() => {
                  setFareIndex(index);
                  setCopied(false);
                }}
                className="accent-primary"
              />
              <span className="flex-1 text-sm capitalize">
                {option.fareName ?? CABIN_LABEL[option.cabin]}
                {option.mixedCabin ? " · mixed cabin" : ""}
                {option.eligibility && (
                  <span className="block text-xs text-amber-700 dark:text-amber-300 mt-1">
                    {option.eligibility.label}
                  </span>
                )}
              </span>
              <span className="text-sm text-right tabular-nums">
                {points(option.points)} points
                <span className="block text-xs text-muted-foreground">
                  + <Money price={option} /> / person
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="ticket-price rounded-xl bg-muted/50 p-5 grid gap-4 grid-cols-2">
        <div>
          <p className="text-sm text-muted-foreground">Points for your party</p>
          <p className="text-2xl font-semibold mt-1 tabular-nums">
            {points(pointsForParty(price, pax))}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Cash for your party</p>
          <p className="text-xl font-semibold mt-1">
            <Money price={price} multiplier={pax} original />
          </p>
        </div>
      </div>
      <div className="booking-primary space-y-3">
        <Button asChild className="h-12 w-full">
          <a href={continueUrl} target="_blank" rel="noopener noreferrer">
            Continue with airline <ArrowUpRight className="size-4" />
          </a>
        </Button>
        <PointsGuide row={row} price={price} pax={pax} wallet={wallet} />
        <SaveFlight row={row} price={price} pax={pax} />
        <p className="text-xs text-muted-foreground">
          The airline will confirm availability and the final price. No points
          are moved here.
        </p>
      </div>
      {price.eligibility && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">{price.eligibility.label}</p>
          <p className="mt-1">{price.eligibility.description}</p>
        </div>
      )}
      {price.mixedCabin && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Mixed cabin: this journey uses different cabins. Check each segment
          before booking.
        </p>
      )}
      {(!!price.bookingNotes?.length || price.refundable !== undefined) && (
        <section className="fare-conditions">
          <h3>Fare conditions</h3>
          <ul>
            {price.refundable !== undefined && (
              <li>
                {price.refundable === null
                  ? "Refundability not reported"
                  : price.refundable
                    ? "Refundable according to the source; check applicable fees."
                    : "Nonrefundable according to the source."}
              </li>
            )}
            {price.bookingNotes?.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}
      {row.stopDetailsUnconfirmed && (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          This source reports connections but may omit intermediate stops on the
          same flight. Confirm all stops on the airline’s itinerary.
        </p>
      )}
      {price.cabinUnconfirmed && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          This is a named fare bundle. Its exact seat type is not supplied for
          this flight; confirm the seat and included benefits with the airline.
        </p>
      )}
      {value !== null && price.cashFare && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Value per point</p>
              <p className="text-2xl font-semibold tabular-nums mt-1">
                {value.toFixed(2)}¢
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">
                Cash fare for your party
              </p>
              <p className="text-lg font-medium mt-1">
                <Money
                  price={{
                    cash: price.cashFare.amount,
                    currency: price.cashFare.currency,
                  }}
                  multiplier={pax}
                  original
                />
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Compared with the lowest cash fare on the same flights in{" "}
            {CABIN_LABEL[cabin].toLowerCase()}. Cash price minus award fees,
            divided by points.
          </p>
          <p className="text-xs text-muted-foreground">
            Cash fare:{" "}
            <span className="capitalize">{price.cashFare.fareName}</span>
            {price.cashFare.refundable === false
              ? " · nonrefundable"
              : price.cashFare.refundable
                ? " · refundable"
                : ""}
            . Fare rules and included benefits can differ. Checked{" "}
            {new Date(price.cashFare.observedAt).toLocaleTimeString("en-US", {
              hour12: timeFormat === "12h",
              hour: "numeric",
              minute: "2-digit",
            })}
            .
          </p>
          <a
            className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
            href={price.cashFare.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Compare cash fares <ArrowUpRight className="size-3.5" />
          </a>
        </div>
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
              {i > 0 && row.segments[i - 1].destination !== s.origin && (
                <p className="text-sm text-amber-600 dark:text-amber-300 mb-2">
                  Transfer from {row.segments[i - 1].destination} to {s.origin}{" "}
                  required.
                </p>
              )}
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
                {s.operatedBy
                  ? `${s.operatedBy} · `
                  : s.airlineName
                    ? `${s.airlineName} · `
                    : ""}
                {s.aircraft ?? "Aircraft not reported"}
                {price.segmentCabins
                  ? price.segmentCabins[i]
                    ? ` · ${CABIN_LABEL[price.segmentCabins[i]!]}`
                    : " · Cabin not reported"
                  : s.cabin
                    ? ` · ${CABIN_LABEL[s.cabin]}`
                    : ""}
              </p>
              {s.technicalStops?.map((stop) => (
                <p
                  key={stop.airport}
                  className="text-sm text-muted-foreground mt-2"
                >
                  Stop in {stop.airport} on the same{" "}
                  {/\b(?:TRAIN|BUS|COACH)\b/i.test(s.aircraft ?? "")
                    ? "service"
                    : "flight"}{" "}
                  · {time(stop.arrival)} – {time(stop.departure)}
                  {stop.duration !== null
                    ? ` · ${duration(stop.duration)}`
                    : ""}
                </p>
              ))}
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
          {price.seatCountLabel ??
            (price.seats === null
              ? "Seat count not reported"
              : `${price.seats} seat${price.seats === 1 ? "" : "s"} reported`)}
        </p>
        <p>
          Observed {new Date(row.observedAt).toLocaleString()} through{" "}
          {row.source}.
        </p>
        {balance !== undefined && (
          <p className="text-foreground font-medium">
            Your wallet: {points(balance)} points.{" "}
            {balance >= pointsForParty(price, pax)
              ? "Enough points for this award."
              : `${points(pointsForParty(price, pax) - balance)} more points needed.`}
          </p>
        )}
        <p>
          Availability can change. Confirm seats and the final price with the
          airline before transferring points.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          className="h-11"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `${programName(row.programId)}: ${row.origin} to ${row.destination}, ${row.date}, ${CABIN_LABEL[cabin]}, ${pax} passengers. ${points(pointsForParty(price, pax))} points; ${cashLabel(price, pax)}. Flights: ${row.segments.map((s) => s.flightNumber).join(", ") || "choose on airline"}. ${continueUrl}`,
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
