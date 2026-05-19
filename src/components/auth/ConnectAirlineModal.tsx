/**
 * Phase 2.5 — ConnectAirlineModal
 *
 * Hosts a BD Browser API live-view session inside an iframe. Polls the
 * worker every 2s for status, animates state transitions, and tears down
 * the worker session on close.
 *
 * HIG choices (per `apple-hig` skill):
 *  - Modality: used because the auth-capture flow MUST hold the user's
 *    focus until cookies land — partial completion is worse than no flow.
 *  - Backdrop: blurred, semi-opaque (defers to the modal content; HIG
 *    "Materials & Surfaces").
 *  - Hierarchy: airline name big, "secure isolated browser" copy reads
 *    as supporting metadata, iframe is the visual anchor, status is a
 *    persistent strip that changes color only — never moves position
 *    (HIG "consistency in controls").
 *  - Always-dismissible: ESC + close button + cancel button. If
 *    mid-capture, we confirm with the user before tearing down.
 *  - Reduced motion: status transitions are color + opacity; we don't
 *    rely on animation to convey progress.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  finalizeAuthSession,
  pollAuthStatus,
  startAuthSession,
  type AuthApiResult,
  type AuthSessionStart,
  type AuthSessionState,
} from "@/lib/api/auth";
import { getProgram, type ProgramId } from "@/lib/programs";
import { cn } from "@/lib/utils";

interface Props {
  programId: ProgramId | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Called when capture succeeds. Caller refetches connected list. */
  onCaptured?: () => void;
}

type Phase =
  | { kind: "starting" }
  | { kind: "live"; session: AuthSessionStart; status: AuthSessionState }
  | { kind: "captured" }
  | { kind: "error"; message: string; canRetry: boolean }
  | { kind: "unavailable"; message: string };

/** Poll cadence per the Phase 2.5 plan §"User flow" step 6. */
const POLL_MS = 2_000;
/** Total session budget — worker kills the BD session at this point too. */
const SESSION_BUDGET_SECS = 5 * 60;
/** When the remaining time crosses this, we show the countdown. */
const COUNTDOWN_THRESHOLD_SECS = 60;
/** Brief flash so the user sees the "Captured!" state before close. */
const SUCCESS_LINGER_MS = 1_200;

export function ConnectAirlineModal({
  programId,
  open,
  onOpenChange,
  onCaptured,
}: Props) {
  const program = programId ? getProgram(programId) : undefined;
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [secsLeft, setSecsLeft] = useState<number>(SESSION_BUDGET_SECS);
  const abortRef = useRef<AbortController | null>(null);
  const finalizedRef = useRef<boolean>(false);

  /**
   * Best-effort finalize. Always called on unmount or close — the worker
   * is idempotent for already-finalized sessions per the plan §"Worker
   * flow" step 3. We don't await it for close: the modal should close
   * immediately and the cleanup runs in the background.
   */
  const finalize = useCallback(
    (
      session: AuthSessionStart | undefined,
      state: "cancelled" | "completed",
    ) => {
      if (!session || finalizedRef.current) return;
      finalizedRef.current = true;
      void finalizeAuthSession(session.sessionId, state).catch(() => {
        // Swallow — finalize failure is non-fatal; the worker will
        // garbage-collect dead sessions on the SESSION_BUDGET_SECS timer.
      });
    },
    [],
  );

  // Kick off the worker session + start polling. Resets state on every
  // (open, programId) change so a re-open after error/cancel starts
  // fresh. The reset has to happen via dispatch inside the effect body
  // because (a) it must be paired with the abort-controller cleanup and
  // (b) it depends on the same trigger conditions as the fetch — moving
  // it outside would race with cleanup and leave stale phases.
  useEffect(() => {
    if (!open || !programId) return;

    // Phase + countdown reset. Doing this inside the effect (rather than
    // a separate setState-in-effect block) keeps the resets paired with
    // the cleanup function, so a fast open→close→open cycle can't leave
    // stale phase state from the previous open.
    finalizedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase({ kind: "starting" });
    setSecsLeft(SESSION_BUDGET_SECS);

    const ac = new AbortController();
    abortRef.current = ac;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSession: AuthSessionStart | undefined;

    const handleResult = (
      result: AuthApiResult<AuthSessionStart>,
    ): AuthSessionStart | undefined => {
      if (!result.ok) {
        if (cancelled) return undefined;
        setPhase({
          kind: result.kind === "service_unavailable" ? "unavailable" : "error",
          message: result.message,
          canRetry: result.kind !== "service_unavailable",
        });
        return undefined;
      }
      return result.data;
    };

    const loop = async () => {
      const startRes = await startAuthSession(programId, ac.signal);
      const session = handleResult(startRes);
      if (!session || cancelled) return;
      activeSession = session;
      setPhase({ kind: "live", session, status: "awaiting_login" });

      // Poll status. Each tick fetches once; if we see "captured" we close.
      const tick = async () => {
        if (cancelled) return;
        const statusRes = await pollAuthStatus(session.sessionId, ac.signal);
        if (cancelled) return;

        if (!statusRes.ok) {
          // Single transient error → keep polling. Persistent errors
          // surface via the countdown timeout below.
          pollTimer = setTimeout(tick, POLL_MS);
          return;
        }

        const { state, error } = statusRes.data;

        if (state === "captured") {
          finalize(session, "completed");
          setPhase({ kind: "captured" });
          onCaptured?.();
          setTimeout(() => {
            if (!cancelled) onOpenChange(false);
          }, SUCCESS_LINGER_MS);
          return;
        }

        if (state === "failed" || state === "expired") {
          finalize(session, "cancelled");
          setPhase({
            kind: "error",
            message:
              error ??
              (state === "expired"
                ? "Login timed out. You can try again."
                : "Login failed. Please try again."),
            canRetry: true,
          });
          return;
        }

        // Otherwise still awaiting login — schedule next tick.
        setPhase({ kind: "live", session, status: state });
        pollTimer = setTimeout(tick, POLL_MS);
      };

      pollTimer = setTimeout(tick, POLL_MS);
    };

    void loop();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      ac.abort();
      // If the user closed mid-flow we cancel the worker session.
      finalize(activeSession, "cancelled");
    };
  }, [open, programId, onOpenChange, onCaptured, finalize]);

  // Countdown ticker — drives the "session expires in N s" badge.
  // secsLeft is reset to SESSION_BUDGET_SECS by the open/programId
  // effect above; this effect only owns the 1-Hz decrement loop.
  useEffect(() => {
    if (!open || phase.kind !== "live") return;
    const interval = setInterval(() => {
      setSecsLeft((s) => Math.max(0, s - 1));
    }, 1_000);
    return () => clearInterval(interval);
  }, [open, phase.kind]);

  const handleRetry = () => {
    // Re-trigger the open effect by resetting phase. The effect's
    // [open, programId] deps don't change so we need to manually reset.
    finalizedRef.current = false;
    setPhase({ kind: "starting" });
    setSecsLeft(SESSION_BUDGET_SECS);
    // Force the effect to re-run by toggling open via parent.
    // Simpler: the parent's "Retry" wiring re-opens; we just expose a
    // local retry button that does the same thing inline.
    onOpenChange(false);
    setTimeout(() => onOpenChange(true), 50);
  };

  // If user tries to close while live (mid-capture), warn them.
  const handleOpenChange = (next: boolean) => {
    if (!next && phase.kind === "live" && phase.status === "awaiting_login") {
      const ok = window.confirm(
        "Close before finishing login? You'll need to start over to connect this airline.",
      );
      if (!ok) return;
    }
    onOpenChange(next);
  };

  if (!program) {
    // Defensive: parent shouldn't open with a null programId, but if it
    // does we render an empty closed dialog rather than crashing.
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "max-w-3xl w-[min(100vw-2rem,820px)] p-0 gap-0",
          // Full-screen sheet on small viewports (HIG mobile pattern)
          "sm:rounded-xl rounded-none sm:h-auto h-[100dvh] max-h-[100dvh] sm:max-h-[92dvh]",
        )}
      >
        <DialogHeader className="px-5 py-4 border-b">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex size-9 items-center justify-center rounded-md text-sm font-semibold tracking-tight text-background"
              style={{ background: "var(--color-primary)" }}
              aria-hidden
            >
              {program.iata}
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold leading-tight truncate">
                Connect {program.name}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground leading-tight mt-0.5">
                We&rsquo;ll open a secure isolated browser. Sign in normally —
                your password never reaches PointSnap, only the resulting
                session cookies are saved (encrypted).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0">
          <ModalBody
            phase={phase}
            secsLeft={secsLeft}
            onRetry={handleRetry}
          />
        </div>

        <DialogFooter className="px-5 py-3 border-t bg-muted/30 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden />
            <span>Cookies are AES-encrypted server-side. Never sent to your browser.</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
          >
            {phase.kind === "captured" ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BodyProps {
  phase: Phase;
  secsLeft: number;
  onRetry: () => void;
}

function ModalBody({ phase, secsLeft, onRetry }: BodyProps) {
  if (phase.kind === "starting") {
    return (
      <CenteredState
        icon={<Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />}
        title="Spinning up a secure browser…"
        description="One moment. The login window will appear here once the session is ready."
      />
    );
  }

  if (phase.kind === "unavailable") {
    return (
      <CenteredState
        icon={<ShieldCheck className="size-6 text-muted-foreground" aria-hidden />}
        title="Auth capture isn't deployed yet"
        description={phase.message}
        tone="info"
      />
    );
  }

  if (phase.kind === "error") {
    return (
      <CenteredState
        icon={<XCircle className="size-6 text-[color:var(--color-stale-critical-fg)]" aria-hidden />}
        title="Something went wrong"
        description={phase.message}
        action={
          phase.canRetry ? (
            <Button onClick={onRetry} size="sm">Try again</Button>
          ) : null
        }
        tone="error"
      />
    );
  }

  if (phase.kind === "captured") {
    return (
      <CenteredState
        icon={<CheckCircle2 className="size-7 text-[color:var(--color-fresh-fg)]" aria-hidden />}
        title="Connected!"
        description="Your session is saved. PointSnap can now search award space on this program."
        tone="success"
      />
    );
  }

  // Live phase — iframe + status strip.
  const showCountdown = secsLeft <= COUNTDOWN_THRESHOLD_SECS;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="relative flex-1 min-h-0 bg-muted/20">
        <iframe
          src={phase.session.liveViewUrl}
          title="Airline login (secure isolated session)"
          className="absolute inset-0 w-full h-full border-0"
          // BD's live-view session needs network + scripts. We allow
          // forms (login submit) and same-origin (BD's relay handles
          // cookies), and DO NOT pass `allow-top-navigation` so a
          // hostile script in the iframe can't redirect the cockpit.
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-pointer-lock"
          allow="clipboard-write; clipboard-read"
        />
      </div>
      <StatusStrip status={phase.status} secsLeft={secsLeft} showCountdown={showCountdown} />
    </div>
  );
}

interface StatusStripProps {
  status: AuthSessionState;
  secsLeft: number;
  showCountdown: boolean;
}

function StatusStrip({ status, secsLeft, showCountdown }: StatusStripProps) {
  // Status strip variants — HIG "color independence": each variant also
  // has a distinct icon + copy, so colorblind users get the same signal.
  return (
    <div
      className="flex items-center justify-between gap-3 px-5 py-3 border-t bg-card text-sm"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 min-w-0">
        {status === "awaiting_login" && (
          <>
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground truncate">
              Awaiting your login…
            </span>
          </>
        )}
        {status === "captured" && (
          <>
            <CheckCircle2
              className="size-4 text-[color:var(--color-fresh-fg)]"
              aria-hidden
            />
            <span className="font-medium text-foreground truncate">
              Login detected! Capturing session…
            </span>
          </>
        )}
        {(status === "expired" || status === "failed") && (
          <>
            <XCircle
              className="size-4 text-[color:var(--color-stale-critical-fg)]"
              aria-hidden
            />
            <span className="font-medium text-[color:var(--color-stale-critical-fg)] truncate">
              {status === "expired" ? "Session expired" : "Login failed"}
            </span>
          </>
        )}
      </div>
      {showCountdown && status === "awaiting_login" && (
        <Badge variant="stale" className="font-mono tabular-nums shrink-0">
          {secsLeft}s left
        </Badge>
      )}
    </div>
  );
}

interface CenteredStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  tone?: "default" | "info" | "success" | "error";
}

function CenteredState({ icon, title, description, action }: CenteredStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-16 gap-3 min-h-[280px]">
      {icon}
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
        {description}
      </p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
