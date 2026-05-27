import { cn } from "@/lib/utils";
import { formatMiles, formatUsdCents } from "@/lib/effectiveCost";
import type { Cabin, CabinPrice } from "@/lib/types";

interface CabinCellProps {
  cabin: Cabin;
  price?: CabinPrice;
  compress?: boolean;
}

const tintClasses: Record<Cabin, string> = {
  Y: "bg-[color:var(--color-cabin-y)] text-[color:var(--color-cabin-y-fg)]",
  W: "bg-[color:var(--color-cabin-w)] text-[color:var(--color-cabin-w-fg)]",
  J: "bg-[color:var(--color-cabin-j)] text-[color:var(--color-cabin-j-fg)]",
  F: "bg-[color:var(--color-cabin-f)] text-[color:var(--color-cabin-f-fg)]",
};

export function CabinCell({ cabin, price, compress }: CabinCellProps) {
  if (!price) {
    return (
      <td
        className="text-center text-muted-foreground/40 px-2 align-middle tabular-nums"
        aria-label={`${cabin} unavailable`}
      >
        —
      </td>
    );
  }
  const cashCents = Math.round(
    (price.surchargeUsdPerPax + price.taxesUsdPerPax) * 100,
  );
  return (
    <td
      className={cn(
        "text-right align-middle px-2 tabular-nums",
        tintClasses[cabin],
        compress ? "py-1" : "py-2",
      )}
      aria-label={`${cabin} ${formatMiles(price.milesPerPax)} miles plus ${formatUsdCents(cashCents)}`}
    >
      <div className={cn("font-medium", compress ? "text-xs" : "text-sm")}>
        {formatMiles(price.milesPerPax, true)}
      </div>
      <div
        className={cn(
          "text-[10px] opacity-70 flex items-center justify-end gap-1",
          compress && "hidden",
        )}
      >
        <span>+{formatUsdCents(cashCents)}</span>
        <span aria-hidden>·</span>
        <span>{price.seatsRemaining}+ seats</span>
      </div>
    </td>
  );
}
