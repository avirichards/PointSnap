import type { NextRequest } from "next/server";
import { currencyForCountry, type ExchangeRates } from "@/lib/currency";
export async function GET(req: NextRequest) {
  // This deployment sets/overwrites its own geolocation header. Never forward a visitor's IP to an FX service.
  const country = process.env.VERCEL
    ? req.headers.get("x-vercel-ip-country")
    : null;
  let rates: ExchangeRates = {};
  try {
    const response = await fetch(
      "https://api.frankfurter.dev/v2/rates?base=USD",
      { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) throw new Error("Rate service unavailable");
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error("Invalid rates");
    for (const row of data) {
      if (
        row &&
        row.base === "USD" &&
        typeof row.quote === "string" &&
        /^[A-Z]{3}$/.test(row.quote) &&
        typeof row.rate === "number" &&
        Number.isFinite(row.rate) &&
        row.rate > 0 &&
        typeof row.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      )
        rates[row.quote] = { rate: row.rate, date: row.date };
    }
    const latest = Object.values(rates)
      .map((r) => r.date)
      .sort()
      .at(-1);
    if (latest) rates.USD = { rate: 1, date: latest };
  } catch {
    rates = {};
  }
  return Response.json(
    {
      country,
      currency: currencyForCountry(country),
      rates,
      source: "Frankfurter",
      sourceUrl: "https://frankfurter.dev",
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
