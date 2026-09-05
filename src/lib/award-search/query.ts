import { z } from "zod";
import type { SearchQuery } from "@/lib/types";
import { PROGRAM_IDS } from "@/lib/programs";
export const querySchema = z
  .object({
    origin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    dest: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    departDate: z.iso.date(),
    returnDate: z.iso.date().optional(),
    pax: z.coerce.number().int().min(1).max(9).default(1),
    minCabin: z.enum(["Y", "W", "J", "F"]).default("Y"),
  })
  .refine((q) => q.origin !== q.dest, "Choose different airports.")
  .refine(
    (q) => !q.returnDate || q.returnDate >= q.departDate,
    "Return date must follow departure.",
  );
export function parseQuery(
  params: URLSearchParams,
  now = new Date(),
): SearchQuery {
  const q = querySchema.parse(Object.fromEntries(params));
  // Give travelers west of UTC a full local day; per-airline booking windows may be shorter.
  const earliest = new Date(now.getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
  const latest = new Date(now.getTime() + 366 * 86400000)
    .toISOString()
    .slice(0, 10);
  if (
    q.departDate < earliest ||
    q.departDate > latest ||
    (q.returnDate && q.returnDate > latest)
  )
    throw new Error("Choose travel dates within the next year.");
  return q;
}
export function selectedPrograms(params: URLSearchParams): string[] {
  if (!params.has("programs")) return [...PROGRAM_IDS];
  const ids = [...new Set(params.get("programs")!.split(","))];
  if (
    !ids.length ||
    ids.some((id) => !(PROGRAM_IDS as readonly string[]).includes(id))
  )
    throw new Error("Choose supported programs.");
  return ids;
}
export function queryParams(q: SearchQuery) {
  return new URLSearchParams({
    origin: q.origin,
    dest: q.dest,
    departDate: q.departDate,
    pax: String(q.pax),
    minCabin: q.minCabin,
    ...(q.returnDate ? { returnDate: q.returnDate } : {}),
  });
}
