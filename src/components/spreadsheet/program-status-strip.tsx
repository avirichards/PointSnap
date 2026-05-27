"use client";

import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProgramStatus } from "@/hooks/use-search-stream";

const PROGRAM_LABELS: Record<string, string> = {
  UA_MP: "United",
  AC_AEROPLAN: "Aeroplan",
  AS_MILEAGEPLAN: "Alaska",
  AA_AADVANTAGE: "AAdvantage",
  DL_SKYMILES: "Delta",
  BA_AVIOS: "BA Avios",
  AF_FLYINGBLUE: "Flying Blue",
  LH_MILES_MORE: "Miles & More",
  NH_ANA: "ANA",
  CX_CATHAY: "Cathay",
  AV_LIFEMILES: "LifeMiles",
  TK_MILES_SMILES: "Turkish",
  VS_FLYING_CLUB: "Virgin",
};

interface Props {
  programs: ProgramStatus[];
}

export function ProgramStatusStrip({ programs }: Props) {
  if (programs.length === 0) return null;
  return (
    <div
      className="flex flex-wrap gap-1.5 items-center text-xs"
      role="status"
      aria-live="polite"
    >
      <span className="text-muted-foreground mr-1">Querying:</span>
      {programs.map((p) => (
        <span
          key={p.programId}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 border tabular-nums",
            p.state === "pending" &&
              "bg-muted text-muted-foreground border-border",
            p.state === "success" &&
              "bg-[color:var(--color-fresh)]/10 text-[color:var(--color-fresh)] border-[color:var(--color-fresh)]/30",
            p.state === "partial" &&
              "bg-[color:var(--color-stale)]/10 text-[color:var(--color-stale)] border-[color:var(--color-stale)]/30",
            (p.state === "failed" || p.state === "circuit_open") &&
              "bg-[color:var(--color-stale-critical)]/10 text-[color:var(--color-stale-critical)] border-[color:var(--color-stale-critical)]/30",
          )}
        >
          {p.state === "pending" && (
            <Loader2
              className="size-3 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          )}
          {p.state === "success" && <Check className="size-3" aria-hidden />}
          {p.state === "partial" && <Check className="size-3" aria-hidden />}
          {(p.state === "failed" || p.state === "circuit_open") && (
            <X className="size-3" aria-hidden />
          )}
          {PROGRAM_LABELS[p.programId] ?? p.programId}
        </span>
      ))}
    </div>
  );
}
