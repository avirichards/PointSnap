"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  convertMoney,
  currencyForLocale,
  money,
  type ExchangeRates,
} from "@/lib/currency";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal } from "lucide-react";
import { TimeFormatPicker, useTimeFormat } from "./time-preference";
import { ResultDensityPicker } from "./result-density";
import countryCurrencies from "@/lib/country-currencies.json";
import type { AwardPrice } from "@/lib/award-search/types";
interface CurrencyContext {
  currency: string;
  rates: ExchangeRates;
  setCurrency: (value: string) => void;
  source: string;
  now: number;
}
const Context = createContext<CurrencyContext>({
  currency: "USD",
  rates: {},
  setCurrency: () => {},
  source: "default",
  now: 0,
});
const preferenceEvent = "pointsnap:currency-changed";
const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener(preferenceEvent, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(preferenceEvent, notify);
  };
};
const readPreference = () => {
  try {
    const v = localStorage.getItem("pointsnap:currency");
    return v && /^[A-Z]{3}$/.test(v) ? v : null;
  } catch {
    return null;
  }
};
const subscribeLocale = () => () => {};
const readLocale = () => currencyForLocale(navigator.language);
export const useDisplayCurrency = () => useContext(Context);
export function DisplayCurrencyProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
      subscribe,
      readPreference,
      () => null,
    ),
    locale = useSyncExternalStore(subscribeLocale, readLocale, () => null);
  const [manualFallback, setManualFallback] = useState<string | null>(null),
    [country, setCountry] = useState<string | null>(null),
    [rates, setRates] = useState<ExchangeRates>({}),
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/display-currency", { signal: c.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && !c.signal.aborted) {
          setRates(d.rates ?? {});
          setCountry(d.currency ?? null);
        }
      })
      .catch(() => {});
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, []);
  const currency = manualFallback ?? preference ?? country ?? locale ?? "USD",
    source =
      manualFallback || preference
        ? "your preference"
        : country
          ? "your country"
          : locale
            ? "browser region"
            : "default";
  const setCurrency = (value: string) => {
    try {
      localStorage.setItem("pointsnap:currency", value);
      setManualFallback(null);
      window.dispatchEvent(new Event(preferenceEvent));
    } catch {
      setManualFallback(value);
    }
  };
  return (
    <Context.Provider value={{ currency, rates, setCurrency, source, now }}>
      {children}
    </Context.Provider>
  );
}
export function DisplayPreferences() {
  const { currency } = useDisplayCurrency();
  const { format } = useTimeFormat();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-11 rounded-full text-xs text-muted-foreground"
          aria-label="Display preferences"
        >
          <SlidersHorizontal />
          {currency} · {format === "12h" ? "AM/PM" : "24-hour"}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="rounded-2xl w-80 max-w-[calc(100vw-24px)] p-5 space-y-5"
      >
        <h3 className="font-semibold">Display preferences</h3>
        <CurrencyPicker />
        <TimeFormatPicker />
        <ResultDensityPicker />
        <p className="text-xs text-muted-foreground">
          Saved on this device. Flight times stay local to each airport.
        </p>
      </PopoverContent>
    </Popover>
  );
}
export function CurrencyPicker() {
  const { currency, rates, setCurrency, source } = useDisplayCurrency();
  const tender = new Set(Object.values(countryCurrencies));
  const options = [
    ...new Set([
      currency,
      "USD",
      "EUR",
      "GBP",
      "CAD",
      "AUD",
      "MXN",
      ...Object.keys(rates).filter((c) => tender.has(c)),
    ]),
  ].sort();
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Display currency
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        className="rounded-md border bg-background p-2 text-foreground"
        title={`Default based on ${source}`}
      >
        {options.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </label>
  );
}
export function Money({
  price,
  multiplier = 1,
  original = false,
}: {
  price: Pick<AwardPrice, "cash" | "currency" | "feesIncludedInPoints">;
  multiplier?: number;
  original?: boolean;
}) {
  const { currency, rates, now } = useDisplayCurrency();
  if (price.feesIncludedInPoints) return <>Taxes included in miles</>;
  if (price.cash === null || !price.currency) return <>Fees not reported</>;
  const raw = money(price.cash * multiplier, price.currency),
    converted = convertMoney(
      price.cash * multiplier,
      price.currency,
      currency,
      rates,
      now,
    );
  if (price.currency === currency) return <>{raw}</>;
  if (!converted)
    return (
      <span title="Conversion is unavailable; showing the airline’s original currency.">
        {raw}
        {original && (
          <span className="block text-xs text-muted-foreground">
            Conversion unavailable
          </span>
        )}
      </span>
    );
  return (
    <span
      title={`${raw} charged by airline. Reference exchange rate ${converted.date}; payment rates may differ.`}
    >
      ≈ {money(converted.amount, currency)}
      {original && (
        <span className="block text-xs text-muted-foreground mt-1">
          Airline charges {raw} · rate {converted.date}
        </span>
      )}
    </span>
  );
}
