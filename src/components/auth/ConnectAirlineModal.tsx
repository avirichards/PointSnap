/**
 * ConnectAirlineModal
 *
 * Connects an airline loyalty account. The user types their airline email
 * (or member number) + password into a plain form; the worker drives the
 * airline's own login page itself. If the airline challenges with MFA, the
 * modal collects the code. On success the worker harvests the session
 * cookies and stores them encrypted.
 *
 * Flow / `phase` state:
 *   form    → credential form (email/member-number + password)
 *   working → worker is signing in; poll `/auth/status` every ~2s
 *   mfa     → airline asked for an MFA code; collect + submit it
 *   captured→ success; brief flash, then auto-close
 *   error   → failed / expired; show context screenshot, offer retry
 *
 * `invalid_credentials` from the worker drops back to `form` with an inline
 * error rather than a separate phase — the fix is "re-enter and resubmit".
 *
 * HIG choices (per `apple-hig` skill):
 *  - Modality: justified — the connect flow must hold focus until cookies
 *    land; partial completion is worse than no flow. ESC + close + cancel
 *    always dismiss.
 *  - Hierarchy: airline name is the title; the explainer reads as
 *    supporting metadata; the form fields are the visual anchor.
 *  - Data entry: labeled fields, correct input types (`password`,
 *    `inputMode="numeric"` + `autoComplete="one-time-code"` for the code),
 *    smart autocomplete hints, inline validation, the submit button shows a
 *    disabled + spinner state while the request is in flight.
 *  - Feedback: distinct success and error states; errors say what happened
 *    and what to do; `aria-live` announces state changes.
 *  - Color independence: every state pairs an icon + copy with its color.
 *  - Reduced motion: the only animation is the shared `animate-spin`
 *    spinner; nothing relies on motion to convey progress.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  finalizeAuthSession,
  pollAuthStatus,
  startAuthSession,
  submitMfaCode,
  type AuthApiResult,
  type AuthSessionStart,
  type AuthSessionStatus,
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
  | { kind: "form" }
  | { kind: "working" }
  | { kind: "mfa"; prompt: string | null; screenshotB64: string | null }
  | { kind: "captured" }
  | {
      kind: "error";
      message: string;
      screenshotB64: string | null;
      canRetry: boolean;
    };

/** Poll cadence while the worker is signing in. */
const POLL_MS = 2_000;
/** Brief flash so the user sees the "Connected!" state before close. */
const SUCCESS_LINGER_MS = 1_200;

export function ConnectAirlineModal({
  programId,
  open,
  onOpenChange,
  onCaptured,
}: Props) {
  const program = programId ? getProgram(programId) : undefined;

  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  // Credential form fields. Lifted to the modal so a re-render of the
  // inner body (e.g. an error coming back) doesn't lose what the user
  // typed — the worker rejects nothing client-side, so on
  // invalid_credentials we keep the email and just clear the password.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  /** Inline error shown under the form's password field. */
  const [formError, setFormError] = useState<string | null>(null);
  /** Inline error shown under the MFA code field. */
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  /** True while a start / MFA request is in flight — drives the spinner. */
  const [submitting, setSubmitting] = useState(false);

  // The live worker session. Held in a ref (not state) because the poll
  // loop and the finalize-on-close cleanup both need the *latest* value
  // without re-subscribing — and a session id changing should not, on its
  // own, restart any effect.
  const sessionRef = useRef<AuthSessionStart | null>(null);
  const finalizedRef = useRef(false);
  // Drives the poll loop. Bumped to (re)start polling; the loop reads the
  // session from sessionRef. A ref-counter avoids putting the loop's
  // restart trigger in component state (which would re-render the form).
  const pollGenRef = useRef(0);

  // Parent callbacks held in refs so the poll effect can call the latest
  // version WITHOUT listing them as deps — the /airlines page re-renders
  // on its 1-min clock tick with fresh callback identities, and a restart
  // of the poll loop mid-login would abort the user's connect.
  const onOpenChangeRef = useRef(onOpenChange);
  const onCapturedRef = useRef(onCaptured);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
    onCapturedRef.current = onCaptured;
  });

  /**
   * Best-effort finalize — tears the worker session down. Always called on
   * unmount / close. Idempotent on the worker side; we don't await it so
   * the modal closes immediately and cleanup runs in the background.
   */
  const finalize = useCallback(() => {
    const session = sessionRef.current;
    if (!session || finalizedRef.current) return;
    finalizedRef.current = true;
    void finalizeAuthSession(session.sessionId).catch(() => {
      // Swallow — finalize failure is non-fatal; the worker garbage-
      // collects dead sessions on its own session-budget timer.
    });
  }, []);

  // Reset everything whenever the modal (re)opens for a program. Putting
  // the reset here keeps it paired with the cleanup below, so a fast
  // open→close→open cycle can't leave stale phase / field state.
  useEffect(() => {
    if (!open || !programId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase({ kind: "form" });
    setUsername("");
    setPassword("");
    setMfaCode("");
    setFormError(null);
    setMfaError(null);
    setSubmitting(false);
    sessionRef.current = null;
    finalizedRef.current = false;
    pollGenRef.current += 1;

    return () => {
      // Modal closed (or program changed) — tear down any live session.
      pollGenRef.current += 1;
      finalize();
    };
  }, [open, programId, finalize]);

  /**
   * Apply one status snapshot to the phase machine. Shared by the poll
   * loop so the captured / error / mfa transitions live in one place.
   */
  const applyStatus = useCallback((status: AuthSessionStatus) => {
    switch (status.state) {
      case "captured":
        finalize();
        setPhase({ kind: "captured" });
        onCapturedRef.current?.();
        setTimeout(() => {
          onOpenChangeRef.current(false);
        }, SUCCESS_LINGER_MS);
        return;
      case "mfa_required":
        setPhase({
          kind: "mfa",
          prompt: status.mfaPrompt ?? null,
          screenshotB64: status.screenshotB64 ?? null,
        });
        return;
      case "invalid_credentials":
        // Back to the form. Keep the email, clear the password, surface
        // the rejection inline. The worker session is spent — finalize it.
        finalize();
        sessionRef.current = null;
        setPassword("");
        setFormError(
          "That email or password didn't work — try again.",
        );
        setPhase({ kind: "form" });
        return;
      case "failed":
      case "expired":
        finalize();
        setPhase({
          kind: "error",
          message:
            status.error ??
            (status.state === "expired"
              ? "The sign-in timed out before it finished. You can try again."
              : "We couldn't sign in to your account. You can try again."),
          screenshotB64: status.screenshotB64 ?? null,
          canRetry: true,
        });
        return;
      case "working":
      default:
        // Still signing in — keep polling. Don't clobber the mfa phase if
        // the worker briefly reports "working" while it processes a code;
        // applyStatus only moves us off mfa on a terminal/explicit state.
        setPhase((prev) => (prev.kind === "mfa" ? prev : { kind: "working" }));
        return;
    }
  }, [finalize]);

  /**
   * Start the status poll loop for the current session. Each invocation
   * bumps `pollGenRef` and captures the new generation; any stale loop
   * (from a previous session, a retry, or a closed modal) sees the
   * generation has moved and stops itself — that's the whole cancellation
   * mechanism. The loop also stops on its own once a terminal state
   * (captured / failed / expired / invalid_credentials) is observed.
   */
  const startPolling = useCallback(() => {
    pollGenRef.current += 1;
    const gen = pollGenRef.current;

    const tick = async () => {
      if (gen !== pollGenRef.current) return;
      const session = sessionRef.current;
      if (!session) return;

      const res = await pollAuthStatus(session.sessionId);
      if (gen !== pollGenRef.current) return;

      if (!res.ok) {
        if (res.kind === "service_unavailable") {
          finalize();
          setPhase({
            kind: "error",
            message: res.message,
            screenshotB64: null,
            canRetry: false,
          });
          return;
        }
        // A single transient error — keep polling.
        window.setTimeout(tick, POLL_MS);
        return;
      }

      applyStatus(res.data);

      // Only "working" and "mfa_required" are non-terminal — keep polling
      // for those; every other state is terminal and applyStatus has
      // already moved the modal to its final phase.
      const s = res.data.state;
      if (s === "working" || s === "mfa_required") {
        window.setTimeout(tick, POLL_MS);
      }
    };

    window.setTimeout(tick, POLL_MS);
  }, [applyStatus, finalize]);

  // Submit the credential form — start a worker session, then poll.
  const handleConnect = useCallback(async () => {
    if (!programId) return;
    const u = username.trim();
    if (!u || !password) return;

    setFormError(null);
    setSubmitting(true);
    setPhase({ kind: "working" });

    const result: AuthApiResult<AuthSessionStart> = await startAuthSession(
      programId,
      u,
      password,
    );

    setSubmitting(false);

    if (!result.ok) {
      setPhase({
        kind: "error",
        message: result.message,
        screenshotB64: null,
        canRetry: result.kind !== "service_unavailable",
      });
      return;
    }

    sessionRef.current = result.data;
    finalizedRef.current = false;
    // The worker may already be past "working" by the next poll; the loop
    // and applyStatus handle every state from here.
    applyStatus({ state: result.data.state });
    startPolling();
  }, [programId, username, password, applyStatus, startPolling]);

  // Submit the MFA code — hand it to the worker, then resume polling.
  const handleSubmitMfa = useCallback(async () => {
    const session = sessionRef.current;
    const code = mfaCode.trim();
    if (!session || !code) return;

    setMfaError(null);
    setSubmitting(true);

    const result = await submitMfaCode(session.sessionId, code);

    setSubmitting(false);

    if (!result.ok) {
      // Stay on the MFA phase, show the worker's reason inline. The poll
      // loop is still running, so if the worker advanced on its own the
      // modal will follow regardless.
      setMfaError(
        result.message ||
          "That code didn't work — check it and try again.",
      );
      return;
    }

    // Code accepted. Show the working spinner; the still-running poll loop
    // picks up the next state (captured / failed / another mfa prompt).
    setMfaCode("");
    setPhase({ kind: "working" });
  }, [mfaCode]);

  // Retry from an error state — reset back to a fresh form.
  const handleRetry = useCallback(() => {
    finalize();
    sessionRef.current = null;
    finalizedRef.current = false;
    pollGenRef.current += 1;
    setPassword("");
    setMfaCode("");
    setFormError(null);
    setMfaError(null);
    setSubmitting(false);
    setPhase({ kind: "form" });
  }, [finalize]);

  // Warn before closing mid-sign-in so an accidental ESC doesn't waste a
  // half-finished login.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (
        !next &&
        (phase.kind === "working" || phase.kind === "mfa") &&
        !window.confirm(
          "Close before finishing? You'll need to start over to connect this airline.",
        )
      ) {
        return;
      }
      onOpenChange(next);
    },
    [phase.kind, onOpenChange],
  );

  if (!program) {
    // Defensive: parent shouldn't open with a null programId.
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "max-w-md w-[min(100vw-2rem,460px)] p-0 gap-0 grid-rows-none flex flex-col",
          // Full-screen sheet on small viewports (HIG mobile pattern).
          "sm:rounded-xl rounded-none sm:h-auto h-[100dvh] max-h-[100dvh] sm:max-h-[92dvh]",
        )}
      >
        <DialogHeader className="px-5 py-4 border-b text-left">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold tracking-tight text-background"
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
                Sign in with your {program.name} account so PointSnap can
                search award space for you.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          <ModalBody
            phase={phase}
            programName={program.name}
            username={username}
            password={password}
            formError={formError}
            mfaCode={mfaCode}
            mfaError={mfaError}
            submitting={submitting}
            onUsernameChange={setUsername}
            onPasswordChange={setPassword}
            onMfaCodeChange={setMfaCode}
            onConnect={handleConnect}
            onSubmitMfa={handleSubmitMfa}
            onRetry={handleRetry}
          />
        </div>

        <DialogFooter className="px-5 py-3 border-t bg-muted/30 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              Your password is encrypted and stored securely.
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
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
  programName: string;
  username: string;
  password: string;
  formError: string | null;
  mfaCode: string;
  mfaError: string | null;
  submitting: boolean;
  onUsernameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onMfaCodeChange: (v: string) => void;
  onConnect: () => void;
  onSubmitMfa: () => void;
  onRetry: () => void;
}

function ModalBody({
  phase,
  programName,
  username,
  password,
  formError,
  mfaCode,
  mfaError,
  submitting,
  onUsernameChange,
  onPasswordChange,
  onMfaCodeChange,
  onConnect,
  onSubmitMfa,
  onRetry,
}: BodyProps) {
  if (phase.kind === "form") {
    return (
      <CredentialForm
        programName={programName}
        username={username}
        password={password}
        error={formError}
        submitting={submitting}
        onUsernameChange={onUsernameChange}
        onPasswordChange={onPasswordChange}
        onSubmit={onConnect}
      />
    );
  }

  if (phase.kind === "working") {
    return (
      <CenteredState
        icon={
          <Loader2
            className="size-6 animate-spin text-muted-foreground"
            aria-hidden
          />
        }
        title={`Signing in to ${programName}…`}
        description="This usually takes a few seconds. We'll let you know if your account needs a verification code."
      />
    );
  }

  if (phase.kind === "mfa") {
    return (
      <MfaForm
        programName={programName}
        prompt={phase.prompt}
        screenshotB64={phase.screenshotB64}
        code={mfaCode}
        error={mfaError}
        submitting={submitting}
        onCodeChange={onMfaCodeChange}
        onSubmit={onSubmitMfa}
      />
    );
  }

  if (phase.kind === "captured") {
    return (
      <CenteredState
        icon={
          <CheckCircle2
            className="size-7 text-[color:var(--color-fresh-fg)]"
            aria-hidden
          />
        }
        title="Connected!"
        description={`PointSnap can now search award space on ${programName}.`}
      />
    );
  }

  // phase.kind === "error"
  return (
    <CenteredState
      icon={
        <XCircle
          className="size-6 text-[color:var(--color-stale-critical-fg)]"
          aria-hidden
        />
      }
      title="Sign-in didn't finish"
      description={phase.message}
      screenshotB64={phase.screenshotB64}
      action={
        phase.canRetry ? (
          <Button onClick={onRetry} size="sm">
            Try again
          </Button>
        ) : null
      }
    />
  );
}

interface CredentialFormProps {
  programName: string;
  username: string;
  password: string;
  error: string | null;
  submitting: boolean;
  onUsernameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: () => void;
}

function CredentialForm({
  programName,
  username,
  password,
  error,
  submitting,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: CredentialFormProps) {
  const canSubmit = username.trim().length > 0 && password.length > 0;

  return (
    <form
      className="flex flex-col gap-4 px-5 py-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !submitting) onSubmit();
      }}
    >
      <p className="text-sm text-muted-foreground leading-relaxed">
        Enter the email or member number and password you use to sign in at{" "}
        {programName}. PointSnap signs in on your behalf to read award
        availability.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="airline-username">Email or member number</Label>
        <Input
          id="airline-username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          required
          disabled={submitting}
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          placeholder="you@example.com"
          // Autofocus the first field so keyboard users land in the form.
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="airline-password">Password</Label>
        <Input
          id="airline-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={submitting}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder="Your airline password"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "airline-cred-error" : undefined}
        />
        {error ? (
          <p
            id="airline-cred-error"
            role="alert"
            className="text-xs text-[color:var(--color-stale-critical-fg)] leading-snug pt-0.5"
          >
            {error}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        className="w-full gap-2"
        disabled={!canSubmit || submitting}
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Connecting…
          </>
        ) : (
          <>
            <KeyRound className="size-4" aria-hidden />
            Connect
          </>
        )}
      </Button>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Your password is encrypted and stored securely so PointSnap can sign
        in for you. Disconnect anytime to delete it.
      </p>
    </form>
  );
}

interface MfaFormProps {
  programName: string;
  prompt: string | null;
  screenshotB64: string | null;
  code: string;
  error: string | null;
  submitting: boolean;
  onCodeChange: (v: string) => void;
  onSubmit: () => void;
}

function MfaForm({
  programName,
  prompt,
  screenshotB64,
  code,
  error,
  submitting,
  onCodeChange,
  onSubmit,
}: MfaFormProps) {
  const canSubmit = code.trim().length > 0;

  return (
    <form
      className="flex flex-col gap-4 px-5 py-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !submitting) onSubmit();
      }}
    >
      <div className="flex items-start gap-2.5">
        <ShieldCheck
          className="size-5 shrink-0 text-[color:var(--color-primary)] mt-0.5"
          aria-hidden
        />
        <div className="space-y-1">
          <h3 className="text-sm font-semibold tracking-tight">
            {programName} needs a verification code
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {prompt ??
              "Enter the verification code your airline just sent to finish signing in."}
          </p>
        </div>
      </div>

      {screenshotB64 ? (
        // A still from the airline's MFA page for context — decorative,
        // labeled for screen readers, never the primary signal. A plain
        // <img> is correct here: the source is an inline base64 data URI,
        // which next/image's optimizer can't process anyway.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/jpeg;base64,${screenshotB64}`}
          alt={`Screenshot of the ${programName} verification page`}
          className="w-full rounded-md border bg-muted object-contain max-h-44"
        />
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="airline-mfa-code">Verification code</Label>
        <Input
          id="airline-mfa-code"
          name="one-time-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCorrect="off"
          spellCheck={false}
          required
          disabled={submitting}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          placeholder="123456"
          className="tracking-[0.3em] font-mono text-center"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "airline-mfa-error" : undefined}
          autoFocus
        />
        {error ? (
          <p
            id="airline-mfa-error"
            role="alert"
            className="text-xs text-[color:var(--color-stale-critical-fg)] leading-snug pt-0.5"
          >
            {error}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        className="w-full gap-2"
        disabled={!canSubmit || submitting}
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Submitting…
          </>
        ) : (
          "Submit code"
        )}
      </Button>
    </form>
  );
}

interface CenteredStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  screenshotB64?: string | null;
  action?: React.ReactNode;
}

function CenteredState({
  icon,
  title,
  description,
  screenshotB64,
  action,
}: CenteredStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center px-8 py-12 gap-3 min-h-[260px]"
      aria-live="polite"
    >
      {icon}
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
        {description}
      </p>
      {screenshotB64 ? (
        // Plain <img>: inline base64 data URI, not optimizable by next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/jpeg;base64,${screenshotB64}`}
          alt="Screenshot of what the airline showed"
          className="mt-1 w-full max-w-xs rounded-md border bg-muted object-contain max-h-44"
        />
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
