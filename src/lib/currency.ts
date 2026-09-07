import countries from "./country-currencies.json";
export interface ExchangeRate {
  rate: number;
  date: string;
}
export type ExchangeRates = Record<string, ExchangeRate>;
export function currencyForCountry(
  country: string | null | undefined,
): string | null {
  return country
    ? ((countries as Record<string, string>)[country.toUpperCase()] ?? null)
    : null;
}
export function currencyForLocale(locale: string): string | null {
  try {
    return currencyForCountry(new Intl.Locale(locale).region);
  } catch {
    return null;
  }
}
export function convertMoney(
  amount: number | null,
  from: string | null,
  to: string,
  rates: ExchangeRates,
  now = Date.now(),
): { amount: number; date: string | null } | null {
  if (amount === null || !from || !Number.isFinite(amount)) return null;
  if (from === to) return { amount, date: null };
  const source = rates[from],
    target = rates[to];
  const valid = (r: ExchangeRate | undefined) =>
    r &&
    Number.isFinite(r.rate) &&
    r.rate > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
    now - Date.parse(r.date + "T00:00:00Z") <= 7 * 86400000 &&
    Date.parse(r.date + "T00:00:00Z") <= now + 86400000;
  if (!valid(source) || !valid(target)) return null;
  return {
    amount: (amount / source.rate) * target.rate,
    date: source.date < target.date ? source.date : target.date,
  };
}
export function money(amount: number, currency: string) {
  try {
    return (
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(amount) + ` ${currency}`
    );
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
