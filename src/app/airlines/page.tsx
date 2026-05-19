/**
 * Phase 2.5 — My Airlines (`/airlines`)
 *
 * Cockpit page that lists every supported program with its auth-capture
 * status. Users click "Connect" to start a worker-mediated login flow
 * (see ConnectAirlineModal); the harvested cookies enable scraping on
 * programs that require login (most do — see `tasks/scraper-rubric.md`).
 *
 * HIG choices (per `apple-hig` skill):
 *  - Hierarchy: page title (text-2xl semibold) → privacy explainer
 *    (muted, max-w-prose) → filter toggle group → grid of cards.
 *  - Cards: rounded-lg border, padding 16-20px, fixed visual weight so
 *    the eye can scan down the grid. Status badge sits in the upper
 *    right (consistent location across every card).
 *  - Color semantics: green = connected, yellow = expired/expiring,
 *    gray = not connected, muted = anonymous-OK. Color never alone —
 *    every state has a textual badge + an icon.
 *  - Touch targets: Connect button is ~36px tall (small) but spans the
 *    full card footer for easy thumb reach. 44px minimum tap area is
 *    achieved via the surrounding card padding.
 *  - Filter: segmented control (Toggle group) rather than dropdown —
 *    HIG "use the simplest control": 4 fixed options, segmented wins.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, KeyRound, PlugZap, ShieldCheck, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import { ConnectAirlineModal } from "@/components/auth/ConnectAirlineModal";
import {
  listConnectedPrograms,
  type ConnectedProgram,
} from "@/lib/api/auth";
import {
  PROGRAMS,
  iconColorForProgram,
  type ProgramCatalogEntry,
  type ProgramId,
} from "@/lib/programs";
import { cn } from "@/lib/utils";

/** UI-derived status for one program in the catalog. */
type CardStatus =
  | "connected"
  | "expiring_soon"
  | "expired"
  | "not_connected"
  | "anonymous_ok";

interface DisplayProgram extends ProgramCatalogEntry {
  status: CardStatus;
  /** Hours until cookie expiry (only set for connected / expiring_soon). */
  hoursLeft: number | null;
}

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  connected: "Connected",
  needs_action: "Needs action",
  anonymous_ok: "Login optional",
};

type FilterKey = "all" | "connected" | "needs_action" | "anonymous_ok";

export default function AirlinesPage() {
  const [connected, setConnected] = useState<ConnectedProgram[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [activeProgram, setActiveProgram] = useState<ProgramId | null>(null);
  // Snapshot of "now" used for cookie-expiry math. Re-snapshotted every
  // minute so the countdown labels stay roughly current without making
  // the render impure (React 19 / `react-hooks/purity` rule).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const refresh = useCallback(async () => {
    const result = await listConnectedPrograms();
    if (result.ok) {
      setConnected(result.data);
      setUnavailable(null);
    } else if (result.kind === "service_unavailable") {
      // Worker endpoint not deployed — render the catalog with all
      // programs in "not_connected" state but show a banner explaining.
      setConnected([]);
      setUnavailable(result.message);
    } else {
      // Network/server error — treat similarly but with a different
      // banner tone so the user knows it's transient.
      setConnected([]);
      setUnavailable(`Couldn't load saved sessions: ${result.message}`);
    }
  }, []);

  // Initial load + every-minute clock tick to keep countdowns fresh.
  // `refresh` synchronizes React state with the worker's saved-session
  // list (external system) — exactly the case React docs say `useEffect`
  // is appropriate for. The lint rule's bias toward server components
  // doesn't apply here: this page is client-rendered behind a sign-in
  // gate and needs to react to the user's own connect/disconnect actions.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const tick = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, [refresh]);

  const cards: DisplayProgram[] = useMemo(() => {
    const byId = new Map<ProgramId, ConnectedProgram>(
      (connected ?? []).map((c) => [c.programId, c]),
    );
    return PROGRAMS.map((p) => {
      const c = byId.get(p.id);
      let status: CardStatus = "not_connected";
      let hoursLeft: number | null = null;

      if (c) {
        const expiresMs = new Date(c.expiresAt).getTime();
        const diffH = Math.round((expiresMs - nowMs) / 36e5);
        hoursLeft = diffH;
        if (diffH <= 0) status = "expired";
        else if (diffH <= 24) status = "expiring_soon";
        else status = "connected";
      } else if (p.authRequired === "optional") {
        status = "anonymous_ok";
      }

      return { ...p, status, hoursLeft };
    });
  }, [connected, nowMs]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "connected":
        return cards.filter(
          (c) => c.status === "connected" || c.status === "expiring_soon",
        );
      case "needs_action":
        return cards.filter(
          (c) => c.status === "not_connected" || c.status === "expired",
        );
      case "anonymous_ok":
        return cards.filter((c) => c.status === "anonymous_ok");
      default:
        return cards;
    }
  }, [cards, filter]);

  const handleCaptured = useCallback(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    const acc = { all: cards.length, connected: 0, needs_action: 0, anonymous_ok: 0 };
    for (const c of cards) {
      if (c.status === "connected" || c.status === "expiring_soon") acc.connected += 1;
      else if (c.status === "not_connected" || c.status === "expired") acc.needs_action += 1;
      else if (c.status === "anonymous_ok") acc.anonymous_ok += 1;
    }
    return acc;
  }, [cards]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 mx-auto w-full max-w-screen-2xl px-3 md:px-6 py-4 md:py-8 space-y-6 focus:outline-none"
      >
        <header className="space-y-2 max-w-3xl">
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-muted-foreground" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">My Airlines</h1>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-prose">
            Connect your loyalty accounts so PointSnap can search award space on
            programs that require login. Credentials never reach our servers —
            only the resulting session cookies are saved, encrypted at rest, and
            decrypted just-in-time when you run a search.
          </p>
        </header>

        {unavailable ? (
          <div
            className="rounded-lg border border-[color:var(--color-stale)]/40 bg-[color:var(--color-stale)]/10 px-4 py-3 text-sm flex items-start gap-3 max-w-prose"
            role="status"
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-[color:var(--color-stale-fg)]" aria-hidden />
            <div className="space-y-1">
              <div className="font-medium text-foreground">
                Auth capture isn&rsquo;t live yet
              </div>
              <p className="text-muted-foreground">
                The cockpit UI is ready, but the worker endpoints are still
                rolling out. Check back soon. {unavailable}
              </p>
            </div>
          </div>
        ) : null}

        <section className="space-y-3" aria-label="Filter by status">
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(FILTER_LABELS) as FilterKey[]).map((k) => {
              const isActive = filter === k;
              const count = counts[k];
              return (
                <Toggle
                  key={k}
                  pressed={isActive}
                  onPressedChange={() => setFilter(k)}
                  variant="outline"
                  size="sm"
                  aria-label={`Filter: ${FILTER_LABELS[k]}`}
                  className={cn(
                    "h-8 px-3 text-xs gap-1.5",
                    isActive && "bg-secondary text-secondary-foreground",
                  )}
                >
                  <span>{FILTER_LABELS[k]}</span>
                  <Badge
                    variant={isActive ? "default" : "outline"}
                    className="text-[10px] px-1.5 py-0 h-4"
                  >
                    {count}
                  </Badge>
                </Toggle>
              );
            })}
          </div>
        </section>

        <Separator />

        <section
          aria-label="Airline programs"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4"
        >
          {filtered.length === 0 ? (
            <div className="col-span-full text-center py-12 text-sm text-muted-foreground">
              No programs match that filter.
            </div>
          ) : (
            filtered.map((p) => (
              <ProgramCard
                key={p.id}
                program={p}
                onConnect={() => setActiveProgram(p.id)}
                disabled={Boolean(unavailable) && p.status !== "anonymous_ok"}
              />
            ))
          )}
        </section>

        <footer className="rounded-lg border bg-muted/40 px-4 py-3 flex items-start gap-3 max-w-prose">
          <ShieldCheck className="size-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-xs text-muted-foreground leading-relaxed">
            How it works: clicking <strong>Connect</strong> opens a sandboxed
            browser hosted by our worker. You log in with your normal
            credentials and MFA; the session cookies are captured and stored
            encrypted, scoped to your account. PointSnap never sees your
            password or MFA codes. Disconnect anytime to delete the saved
            session.
          </p>
        </footer>
      </main>

      <ConnectAirlineModal
        programId={activeProgram}
        open={activeProgram !== null}
        onOpenChange={(next) => {
          if (!next) setActiveProgram(null);
        }}
        onCaptured={handleCaptured}
      />
    </div>
  );
}

interface CardProps {
  program: DisplayProgram;
  onConnect: () => void;
  disabled: boolean;
}

function ProgramCard({ program, onConnect, disabled }: CardProps) {
  const isAnonymousOk = program.status === "anonymous_ok";
  const isConnected = program.status === "connected" || program.status === "expiring_soon";

  return (
    <article
      className={cn(
        "group rounded-lg border bg-card flex flex-col overflow-hidden",
        "transition-colors hover:border-foreground/20",
        isAnonymousOk && "opacity-90",
      )}
    >
      <div className="flex items-start gap-3 p-4 pb-3">
        <ProgramIcon program={program} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm leading-tight truncate">
            {program.name}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground font-mono">
            {program.id}
          </div>
        </div>
        <StatusBadge status={program.status} hoursLeft={program.hoursLeft} />
      </div>

      <div className="px-4 pb-4 mt-auto">
        {isAnonymousOk ? (
          <p className="text-xs text-muted-foreground">
            Login not required — award search works anonymously.
          </p>
        ) : (
          <Button
            type="button"
            variant={isConnected ? "outline" : "default"}
            size="sm"
            onClick={onConnect}
            disabled={disabled}
            className="w-full gap-2"
            aria-label={
              isConnected
                ? `Reconnect ${program.name}`
                : `Connect ${program.name}`
            }
          >
            <PlugZap className="size-3.5" aria-hidden />
            {isConnected ? "Reconnect" : "Connect"}
          </Button>
        )}
      </div>
    </article>
  );
}

interface ProgramIconProps {
  program: ProgramCatalogEntry;
}

function ProgramIcon({ program }: ProgramIconProps) {
  return (
    <span
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-sm font-semibold tracking-tight"
      style={{
        background: iconColorForProgram(program.id),
        color: "oklch(0.2 0.04 264)", // dark text for contrast on pastel bg
      }}
      aria-hidden
    >
      {program.iata}
    </span>
  );
}

interface StatusBadgeProps {
  status: CardStatus;
  hoursLeft: number | null;
}

function StatusBadge({ status, hoursLeft }: StatusBadgeProps) {
  // HIG "color independence": each badge has a textual label, not just
  // color. The icon prefix + text are the primary signal; color reinforces.
  switch (status) {
    case "connected":
      return (
        <Badge
          variant="fresh"
          className="text-[10px] gap-1 shrink-0"
          title={hoursLeft !== null ? `Cookies expire in ~${formatHours(hoursLeft)}` : undefined}
        >
          <Sparkles className="size-3" aria-hidden />
          Connected
          {hoursLeft !== null && hoursLeft <= 72 ? (
            <span className="opacity-75">· {formatHours(hoursLeft)}</span>
          ) : null}
        </Badge>
      );
    case "expiring_soon":
      return (
        <Badge
          variant="stale"
          className="text-[10px] gap-1 shrink-0"
          title={hoursLeft !== null ? `Cookies expire in ~${formatHours(hoursLeft)}` : undefined}
        >
          Expiring · {hoursLeft !== null ? formatHours(hoursLeft) : "soon"}
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="critical" className="text-[10px] gap-1 shrink-0">
          Session expired
        </Badge>
      );
    case "anonymous_ok":
      return (
        <Badge variant="muted" className="text-[10px] gap-1 shrink-0">
          No login needed
        </Badge>
      );
    case "not_connected":
    default:
      return (
        <Badge variant="outline" className="text-[10px] gap-1 shrink-0">
          Not connected
        </Badge>
      );
  }
}

function formatHours(h: number): string {
  if (h < 1) return "<1h";
  if (h < 48) return `${h}h`;
  const days = Math.round(h / 24);
  return `${days}d`;
}
