import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 tabular-nums",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "text-foreground border-border",
        muted:
          "border-transparent bg-muted text-muted-foreground hover:bg-muted/80",
        fresh:
          "border-transparent bg-[color:var(--color-fresh)]/20 text-[color:var(--color-fresh-fg)] border border-[color:var(--color-fresh)]/40",
        stale:
          "border-transparent bg-[color:var(--color-stale)]/20 text-[color:var(--color-stale-fg)] border border-[color:var(--color-stale)]/40",
        critical:
          "border-transparent bg-[color:var(--color-stale-critical)]/20 text-[color:var(--color-stale-critical-fg)] border border-[color:var(--color-stale-critical)]/40",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
