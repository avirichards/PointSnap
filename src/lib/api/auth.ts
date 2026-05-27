/**
 * User-initiated airline auth-capture client.
 *
 * These helpers wrap the worker's `/auth/*` endpoints. The Next.js API
 * routes at `/api/auth/airline/*` proxy through to the worker so the
 * worker URL stays server-side only (same pattern as `/api/search`).
 *
 * The flow: the user types their airline email/member number + password
 * into the connect modal; the worker drives the airline's own login form
 * itself. If the airline challenges with MFA, the worker reports
 * `mfa_required` and the cockpit collects the code. On success the worker
 * harvests the session cookies and stores them encrypted.
 *
 * The endpoints might not be deployed yet (the worker auth module is being
 * built in parallel). Each helper handles 404 / network errors with a
 * typed "service unavailable" result so the UI can render a friendly
 * "this isn't wired up yet" state instead of a generic error.
 */
"use client";
import type { ProgramId } from "@/lib/programs";

/**
 * Worker-side auth-capture state machine.
 *
 *  - "working"             → the worker is driving the airline login form.
 *  - "mfa_required"        → the airline asked for an MFA code; `mfaPrompt`
 *                            carries the human text from the airline page.
 *  - "captured"            → login succeeded, cookies stored.
 *  - "invalid_credentials" → the email/password was rejected.
 *  - "failed"              → login failed for some other reason.
 *  - "expired"             → the session ran past its budget.
 */
export type AuthSessionState =
  | "working"
  | "mfa_required"
  | "captured"
  | "invalid_credentials"
  | "failed"
  | "expired";

/** Result of `POST /auth/start` — a freshly created worker auth session. */
export interface AuthSessionStart {
  /** Opaque session id; pass to `/auth/status`, `/auth/mfa`, `/auth/finalize`. */
  sessionId: string;
  /** Initial state — always "working" when a session is first created. */
  state: AuthSessionState;
  /** ISO-8601 timestamp; the session is killed by the worker after this. */
  expiresAt: string;
}

/** Snapshot of a worker auth session from `GET /auth/status`. */
export interface AuthSessionStatus {
  state: AuthSessionState;
  /** Best-effort current page URL of the worker's browser. */
  currentUrl?: string | null;
  /** Human text from the airline's MFA page, or null when not at MFA. */
  mfaPrompt?: string | null;
  /** A single base64 JPEG still (no `data:` prefix) for context, or null. */
  screenshotB64?: string | null;
  /** program_auth_sessions row UUID — set once state === "captured". */
  storedRowId?: string | null;
  /** Optional error context from the worker (login failure, rate limit, etc.). */
  error?: string | null;
}

/** Row returned by `/api/auth/airline/connected` — one per saved session. */
export interface ConnectedProgram {
  programId: ProgramId;
  /** ISO-8601 — when the harvested cookies stop being valid. */
  expiresAt: string;
  /** ISO-8601 — last time a search successfully used these cookies. */
  lastUsedAt: string | null;
  /** Optional — last search's outcome (true=ok, false=auth-failed). */
  lastSearchOk: boolean | null;
}

/**
 * Discriminated result so callers don't have to wrap every call in try/catch.
 * `service_unavailable` covers the "worker auth endpoints not yet deployed"
 * case explicitly — the UI surfaces a friendly banner instead of an error.
 */
export type AuthApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "service_unavailable" | "error"; message: string };

const BASE = "/api/auth/airline";

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<AuthApiResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      // Polled endpoints must not be cached by the browser; signed cookies
      // are session-scoped and we always want the latest state.
      cache: "no-store",
    });

    if (res.status === 404 || res.status === 501) {
      return {
        ok: false,
        kind: "service_unavailable",
        message:
          "Auth-capture isn't deployed yet. Check back soon — we're wiring this up across all programs.",
      };
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body && typeof body.message === "string") detail = body.message;
      } catch {
        // Body wasn't JSON — fall back to status code only.
      }
      return { ok: false, kind: "error", message: detail };
    }

    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    // Network errors (DNS / offline / abort) land here.
    const message =
      err instanceof Error ? err.message : "Network request failed.";
    return { ok: false, kind: "error", message };
  }
}

/**
 * Spin up a worker auth session and hand off the user's credentials.
 *
 * The password is sent in the POST body only — never in a query string,
 * never logged. The proxy route resolves the acting user server-side.
 */
export function startAuthSession(
  programId: ProgramId,
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<AuthApiResult<AuthSessionStart>> {
  return request<AuthSessionStart>("/start", {
    method: "POST",
    body: JSON.stringify({ programId, username, password }),
    signal,
  });
}

/**
 * One poll. Caller decides cadence (2s is standard). We deliberately
 * *don't* use long-polling — short polling lets the browser cancel via
 * AbortController on modal-close.
 */
export function pollAuthStatus(
  sessionId: string,
  signal?: AbortSignal,
): Promise<AuthApiResult<AuthSessionStatus>> {
  return request<AuthSessionStatus>(
    `/status?sessionId=${encodeURIComponent(sessionId)}`,
    { method: "GET", signal },
  );
}

/**
 * Submit the MFA code the airline asked for. The worker types it into the
 * airline's MFA form and resumes the login. The code goes in the POST body.
 */
export function submitMfaCode(
  sessionId: string,
  code: string,
  signal?: AbortSignal,
): Promise<AuthApiResult<{ ok: true }>> {
  return request<{ ok: true }>("/mfa", {
    method: "POST",
    body: JSON.stringify({ sessionId, code }),
    signal,
  });
}

/**
 * Tell the worker the cockpit is done with the session so it can tear down
 * the browser. Idempotent on the worker side — safe to call from the
 * modal's cleanup hook even if the session already finished.
 */
export function finalizeAuthSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<AuthApiResult<{ ok: true }>> {
  return request<{ ok: true }>("/finalize", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
    signal,
  });
}

/** List the current user's connected programs. */
export function listConnectedPrograms(
  signal?: AbortSignal,
): Promise<AuthApiResult<ConnectedProgram[]>> {
  return request<ConnectedProgram[]>("/connected", {
    method: "GET",
    signal,
  });
}
