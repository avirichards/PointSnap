/**
 * Phase 2.5 — User-initiated auth capture client.
 *
 * These helpers wrap the worker's `/auth/*` endpoints. The Next.js API
 * routes at `/api/auth/airline/*` proxy through to the worker so the
 * worker URL stays server-side only (same pattern as `/api/search`).
 *
 * The endpoints might not be deployed yet (the worker auth module is being
 * built in parallel). Each helper handles 404 / network errors with a
 * typed "service unavailable" result so the UI can render a friendly
 * "this isn't wired up yet" state instead of a generic error.
 */
"use client";
import type { ProgramId } from "@/lib/programs";

/** A single worker auth session. */
export interface AuthSessionStart {
  /** Opaque session id; pass to `/auth/status` + `/auth/finalize`. */
  sessionId: string;
  /**
   * Same-origin live-view URL — an SSE screenshot stream endpoint
   * (`/api/auth/airline/stream?sessionId=...`). Rendered by LiveSessionView
   * onto a canvas. NOT an iframe URL: BD's hosted DevTools inspector is
   * served with `X-Frame-Options: DENY` so it can't be framed; the worker
   * streams screenshots + replays input instead.
   */
  liveViewUrl: string;
  /** False when the BD session failed to spin up — show an error state. */
  liveViewAvailable: boolean;
  /** Currently always "stream" (the screenshot-stream live view). */
  liveViewKind: string;
  /** Pixel dims the remote browser renders at — canvas maps clicks 1:1. */
  viewport: { w: number; h: number };
  /** ISO-8601 timestamp; session is killed by the worker after this. */
  expiresAt: string;
  /** Best-effort current page URL of the remote browser. */
  currentUrl: string | null;
}

/** Worker-side auth-capture state machine. */
export type AuthSessionState =
  | "awaiting_login"
  | "captured"
  | "expired"
  | "failed";

export interface AuthSessionStatus {
  state: AuthSessionState;
  /** Optional error context from the worker (rate limit, login failure, etc.). */
  error?: string;
  /** Best-effort current page URL of the remote browser. */
  currentUrl?: string | null;
  /** program_auth_sessions row UUID — set once state === "captured". */
  storedRowId?: string | null;
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
          "Auth-capture isn't deployed yet. Check back soon — we're wiring this up across all 23 programs.",
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

/** Spin up a worker auth session. Returns the iframe URL. */
export function startAuthSession(
  programId: ProgramId,
  signal?: AbortSignal,
): Promise<AuthApiResult<AuthSessionStart>> {
  return request<AuthSessionStart>("/start", {
    method: "POST",
    body: JSON.stringify({ programId }),
    signal,
  });
}

/**
 * One poll. Caller decides cadence (2s is standard per the plan). We
 * deliberately *don't* use long-polling here — short polling lets the
 * browser cancel via AbortController on modal-close.
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
 * Tell the worker the cockpit is done with the session. `state` lets us
 * distinguish a successful capture from a user-cancelled modal — the
 * worker tears down the session in either case but logs the outcome.
 */
export function finalizeAuthSession(
  sessionId: string,
  state: "cancelled" | "completed",
  signal?: AbortSignal,
): Promise<AuthApiResult<{ ok: true }>> {
  return request<{ ok: true }>("/finalize", {
    method: "POST",
    body: JSON.stringify({ sessionId, state }),
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
