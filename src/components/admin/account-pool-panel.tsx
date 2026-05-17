import Link from "next/link";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface PoolRow {
  programId: string;
  programName: string;
  active: number;
  banned: number;
  exhausted: number;
  disabled: number;
  total: number;
  recentlyUsed: number; // last hour
}

interface Props {
  rows: PoolRow[];
}

export function AccountPoolPanel({ rows }: Props) {
  const totalActive = rows.reduce((acc, r) => acc + r.active, 0);
  const totalBanned = rows.reduce((acc, r) => acc + r.banned, 0);
  const programsWithZero = rows.filter((r) => r.total === 0).length;

  return (
    <section className="rounded-lg border bg-card">
      <header className="p-3 md:p-4 space-y-1">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-medium">Scraper account pool</h2>
          <Badge variant="outline" className="text-xs">
            {totalActive} active · {totalBanned} banned · {programsWithZero} programs empty
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground max-w-prose">
          Per-program rotation across warmed airline accounts. Credentials
          live in Fly secrets (rotation-friendly); this table tracks the
          metadata. Add accounts via SQL insert + matching{" "}
          <code className="text-[10px] font-mono px-1 bg-muted rounded">
            fly secrets set
          </code>{" "}
          calls — see <Link href="/docs/scraper-setup" className="underline">scraper-setup.md</Link>.
        </p>
      </header>
      <Separator />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 md:px-4 py-2 font-medium">Program</th>
              <th className="px-3 md:px-4 py-2 font-medium text-right">Active</th>
              <th className="px-3 md:px-4 py-2 font-medium text-right">Banned</th>
              <th className="px-3 md:px-4 py-2 font-medium text-right">Other</th>
              <th className="px-3 md:px-4 py-2 font-medium text-right">Total</th>
              <th className="px-3 md:px-4 py-2 font-medium text-right">Used 1h</th>
              <th className="px-3 md:px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const empty = r.total === 0;
              const allBanned = r.total > 0 && r.active === 0;
              return (
                <tr key={r.programId} className="hover:bg-accent/30 transition-colors">
                  <td className="px-3 md:px-4 py-2">
                    <div className="font-medium">{r.programName}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {r.programId}
                    </div>
                  </td>
                  <td className={cn(
                    "px-3 md:px-4 py-2 text-right tabular-nums font-medium",
                    r.active > 0 ? "text-foreground" : "text-muted-foreground/60",
                  )}>
                    {r.active}
                  </td>
                  <td className={cn(
                    "px-3 md:px-4 py-2 text-right tabular-nums",
                    r.banned > 0 ? "text-[color:var(--color-stale-critical-fg)]" : "text-muted-foreground/60",
                  )}>
                    {r.banned}
                  </td>
                  <td className="px-3 md:px-4 py-2 text-right tabular-nums text-muted-foreground/60">
                    {r.exhausted + r.disabled}
                  </td>
                  <td className="px-3 md:px-4 py-2 text-right tabular-nums">
                    {r.total}
                  </td>
                  <td className="px-3 md:px-4 py-2 text-right tabular-nums">
                    {r.recentlyUsed}
                  </td>
                  <td className="px-3 md:px-4 py-2">
                    {empty ? (
                      <Badge variant="outline" className="text-[10px]">
                        no accounts — env-fallback only
                      </Badge>
                    ) : allBanned ? (
                      <Badge variant="critical" className="text-[10px]">
                        all banned
                      </Badge>
                    ) : (
                      <Badge variant="fresh" className="text-[10px]">
                        OK
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
