"""T5' user-auth-capture helpers.

The Phase 2.5 cockpit flow (see plan: "Phase 2.5: User-Initiated Auth
Capture" and `tasks/scraper-research/agent-5-auth-viability.md`) streams
a Bright Data Browser API session into an iframe so the user can log in
to their airline loyalty account with their own credentials + MFA. After
the worker detects a successful login, it dumps the resulting session
cookies and stores them encrypted-at-rest in `program_auth_sessions`.

On every subsequent search for that (user, program) pair, the worker:
  1. reads the row via `get_active_session()`
  2. decrypts via `decrypt_cookies()` (server-side, Supabase Vault —
     authenticated encryption, Supabase manages the key out-of-band)
  3. injects the cookie list into a fresh Camoufox / Patchright context
     via `inject_cookies()`

The migration `20260519211710_program_auth_sessions.sql` provides the
encryption primitives — Python never sees the encryption key. The wrapper
SQL functions `public.encrypt_cookies(plain, user_id, program_id,
existing_secret_id)` and `public.decrypt_cookies(secret_id, user_id,
program_id)` are owned by postgres and run SECURITY DEFINER, so we
expose only those to service_role rather than direct Vault access.

This module deliberately ignores the `auth.users` foreign key when the
worker's `DATABASE_URL` happens to not have RLS context — service_role
bypasses RLS, and the FK is enforced regardless. The Phase 2.5 cockpit
endpoints must always pass an authenticated user_id from the SSR session.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import psycopg

log = logging.getLogger(__name__)


def _database_url() -> str | None:
    return os.environ.get("DATABASE_URL")


# ----------------------------------------------------------------------
# Read path
# ----------------------------------------------------------------------
async def get_active_session(user_id: str, program_id: str) -> dict | None:
    """Return the active (non-expired) auth session for (user, program).

    Shape:
        {
          "session_id":  <uuid str>,        # program_auth_sessions.id
          "cookies":     [<cookie dict>...] # ready for Playwright add_cookies()
          "expires_at":  "2026-06-19T...",
          "meta":        {...},             # non-secret metadata
        }

    Returns None when:
      - DATABASE_URL is unset / connect fails
      - No row exists for (user_id, program_id)
      - The row's expires_at is in the past

    The returned `cookies` list is JSON-parsed from the decrypted text
    payload (we store cookies as JSON of Playwright's cookie shape).
    """
    dsn = _database_url()
    if not dsn:
        log.warning("auth_session.get_active_session: DATABASE_URL unset")
        return None

    try:
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            async with conn.cursor() as cur:
                # Fetch + decrypt in one round-trip. The decrypt happens
                # in-database via the SECURITY DEFINER wrapper (Vault), which
                # also verifies the secret's metadata name matches the row's
                # (user_id, program_id) before returning cleartext — defense
                # against a swapped pointer attack.
                await cur.execute(
                    """
                    SELECT
                      id,
                      public.decrypt_cookies(cookies_secret_id, user_id, program_id) AS cookies_json,
                      cookies_meta,
                      expires_at,
                      cookies_secret_id
                    FROM public.program_auth_sessions
                    WHERE user_id = %s
                      AND program_id = %s
                    LIMIT 1
                    """,
                    (user_id, program_id),
                )
                row = await cur.fetchone()
                if not row:
                    return None
                session_id, cookies_json, meta, expires_at, secret_id = row

                # Expired?
                if expires_at and expires_at <= datetime.now(timezone.utc):
                    return None

                if cookies_json is None:
                    # decrypt_cookies returned NULL — pointer/Vault mismatch.
                    log.warning(
                        "auth_session.get_active_session: decrypt returned "
                        "NULL for session %s (secret_id=%s) — likely a "
                        "stale row or swap attack",
                        session_id,
                        secret_id,
                    )
                    return None

                try:
                    cookies = json.loads(cookies_json)
                except (json.JSONDecodeError, TypeError) as exc:
                    log.warning(
                        "auth_session.get_active_session: bad JSON for "
                        "session %s: %s",
                        session_id,
                        exc,
                    )
                    return None

                return {
                    "session_id": str(session_id),
                    "cookies": cookies,
                    "expires_at": expires_at.isoformat() if expires_at else None,
                    "meta": meta or {},
                }
    except Exception as exc:  # noqa: BLE001
        log.warning("auth_session.get_active_session: DB error: %s", exc)
        return None


# ----------------------------------------------------------------------
# Write path
# ----------------------------------------------------------------------
async def save_session(
    user_id: str,
    program_id: str,
    cookies: list[dict],
    expires_at: str,
    meta: dict | None = None,
) -> str | None:
    """Encrypt the cookie blob and upsert the session row.

    Args:
        user_id:   auth.users(id) UUID string. Must be a real user.
        program_id: e.g. "AC_AEROPLAN"
        cookies:    Playwright-shape cookie dicts (name/value/domain/path/...)
        expires_at: ISO-8601 timestamp string in UTC.
        meta:       non-secret hint blob (cookie names, domains, login URL,
                    last-known balance) — stored in cookies_meta jsonb.

    Returns the program_auth_sessions.id (UUID string) on success, None on
    failure. Idempotent: a second call with the same (user_id, program_id)
    replaces the row's ciphertext + expires_at + meta (UNIQUE constraint
    drives the ON CONFLICT path).
    """
    dsn = _database_url()
    if not dsn:
        log.warning("auth_session.save_session: DATABASE_URL unset")
        return None

    cookies_json = json.dumps(cookies, separators=(",", ":"))
    meta_json = json.dumps(meta or {})

    try:
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            async with conn.cursor() as cur:
                # Two-step write: (1) read any existing row's secret id so
                # we update-in-place rather than orphan vault rows; (2)
                # upsert the table row. encrypt_cookies() handles the Vault
                # create-or-update internally and returns the resulting
                # secret_id which we store on the table row.
                #
                # We do this as a single SQL with a CTE so it's still one
                # round-trip and atomic. The CTE computes the resolved
                # secret_id by calling encrypt_cookies with whatever
                # existing_secret_id we found (NULL on first connect).
                await cur.execute(
                    """
                    WITH existing AS (
                      SELECT cookies_secret_id
                        FROM public.program_auth_sessions
                       WHERE user_id = %s::uuid
                         AND program_id = %s
                    ),
                    enc AS (
                      SELECT public.encrypt_cookies(
                               %s,
                               %s::uuid,
                               %s,
                               (SELECT cookies_secret_id FROM existing)
                             ) AS secret_id
                    )
                    INSERT INTO public.program_auth_sessions (
                      user_id,
                      program_id,
                      cookies_secret_id,
                      cookies_meta,
                      expires_at
                    )
                    SELECT
                      %s::uuid,
                      %s,
                      enc.secret_id,
                      %s::jsonb,
                      %s::timestamptz
                    FROM enc
                    ON CONFLICT (user_id, program_id)
                    DO UPDATE SET
                      cookies_secret_id = EXCLUDED.cookies_secret_id,
                      cookies_meta      = EXCLUDED.cookies_meta,
                      expires_at        = EXCLUDED.expires_at,
                      last_used_at      = NULL,
                      last_search_ok    = NULL,
                      updated_at        = now()
                    RETURNING id
                    """,
                    (
                        # existing CTE — lookup keys
                        user_id, program_id,
                        # enc CTE — encrypt args
                        cookies_json, user_id, program_id,
                        # INSERT values
                        user_id, program_id, meta_json, expires_at,
                    ),
                )
                row = await cur.fetchone()
                await conn.commit()
                if row:
                    return str(row[0])
                return None
    except Exception as exc:  # noqa: BLE001
        log.warning("auth_session.save_session: DB error: %s", exc)
        return None


async def mark_used(session_id: str, ok: bool) -> None:
    """Record the outcome of a search that used this session's cookies.

    Future-you uses this to (a) decide whether to suggest reconnect to the
    user, and (b) feed a per-program health metric. Cheap UPDATE; failures
    are non-fatal (just log + move on).
    """
    dsn = _database_url()
    if not dsn:
        return
    try:
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE public.program_auth_sessions
                       SET last_used_at = now(),
                           last_search_ok = %s
                     WHERE id = %s::uuid
                    """,
                    (ok, session_id),
                )
                await conn.commit()
    except Exception as exc:  # noqa: BLE001
        log.warning("auth_session.mark_used: DB error: %s", exc)


async def list_sessions(user_id: str) -> list[dict]:
    """Return every saved auth session for a user — one row per program.

    Used by the cockpit's `/airlines` page (via the worker `/auth/connected`
    endpoint) to render each program's connection status. We never decrypt
    here: the cockpit only needs program_id + expiry + last-use metadata,
    all of which live in non-secret columns. Expired rows are still
    returned so the cockpit can render an "expired — reconnect" badge.

    Shape (per row):
        {
          "program_id":     "AC_AEROPLAN",
          "expires_at":     "2026-06-19T...",   # ISO-8601
          "last_used_at":   "2026-05-20T..." | None,
          "last_search_ok": True | False | None,
        }

    Returns [] when DATABASE_URL is unset, the table is missing, or the
    user has no saved sessions.
    """
    dsn = _database_url()
    if not dsn:
        log.warning("auth_session.list_sessions: DATABASE_URL unset")
        return []
    try:
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT program_id, expires_at, last_used_at, last_search_ok
                      FROM public.program_auth_sessions
                     WHERE user_id = %s::uuid
                     ORDER BY program_id
                    """,
                    (user_id,),
                )
                rows = await cur.fetchall()
                return [
                    {
                        "program_id": program_id,
                        "expires_at": expires_at.isoformat() if expires_at else None,
                        "last_used_at": last_used_at.isoformat() if last_used_at else None,
                        "last_search_ok": last_search_ok,
                    }
                    for (program_id, expires_at, last_used_at, last_search_ok) in rows
                ]
    except Exception as exc:  # noqa: BLE001
        log.warning("auth_session.list_sessions: DB error: %s", exc)
        return []


async def delete_session(user_id: str, program_id: str) -> bool:
    """Forget a session (user clicked Disconnect in the cockpit).

    Returns True on a row delete, False if nothing matched or on error.
    """
    dsn = _database_url()
    if not dsn:
        return False
    try:
        async with await psycopg.AsyncConnection.connect(dsn) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    DELETE FROM public.program_auth_sessions
                     WHERE user_id = %s AND program_id = %s
                    """,
                    (user_id, program_id),
                )
                deleted = cur.rowcount
                await conn.commit()
                return deleted > 0
    except Exception as exc:  # noqa: BLE001
        log.warning("auth_session.delete_session: DB error: %s", exc)
        return False


# ----------------------------------------------------------------------
# Cookie injection
# ----------------------------------------------------------------------
async def inject_cookies(context: Any, cookies: list[dict]) -> int:
    """Push a cookie list into a Playwright/Camoufox BrowserContext.

    `context` is whatever `browser.new_context()` returned (Camoufox uses
    a Playwright-compatible Firefox context, Patchright wraps Chromium —
    both expose `context.add_cookies(list)`).

    Returns the number of cookies actually accepted. Cookies from
    Playwright's own `context.cookies()` round-trip cleanly; cookies
    from BD's CDP `Network.getAllCookies` need light normalization
    (sameSite values, expiry int vs float). We do that normalization
    here so callers can hand us raw BD CDP output.
    """
    if not cookies:
        return 0

    normalized: list[dict] = []
    for c in cookies:
        # Required fields: name, value. Then EITHER (url) OR
        # (domain + path). BD CDP gives us domain+path so we lean on that.
        if not c.get("name") or "value" not in c:
            continue

        nc: dict = {
            "name": c["name"],
            "value": str(c["value"]),
        }

        # Domain / path / url — prefer explicit domain+path.
        if c.get("domain"):
            nc["domain"] = c["domain"]
            nc["path"] = c.get("path") or "/"
        elif c.get("url"):
            nc["url"] = c["url"]
        else:
            # Skip cookies with no targetable origin — they would fail
            # add_cookies anyway.
            continue

        # Booleans (BD CDP returns httpOnly/secure as bools; some sources
        # use 1/0).
        if "httpOnly" in c:
            nc["httpOnly"] = bool(c["httpOnly"])
        if "secure" in c:
            nc["secure"] = bool(c["secure"])

        # sameSite: Playwright accepts "Strict" | "Lax" | "None".
        # CDP emits "Strict" | "Lax" | "None" | "Unspecified".
        ss = c.get("sameSite")
        if ss and ss in ("Strict", "Lax", "None"):
            nc["sameSite"] = ss

        # Expiry: Playwright wants integer seconds-since-epoch; CDP gives
        # us a float ("expires"). Session cookies have no `expires` and
        # we just leave that field out.
        exp = c.get("expires")
        if exp is not None and exp != -1:
            try:
                nc["expires"] = int(exp)
            except (TypeError, ValueError):
                pass

        normalized.append(nc)

    if not normalized:
        return 0

    try:
        await context.add_cookies(normalized)
        return len(normalized)
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "auth_session.inject_cookies: add_cookies failed: %s "
            "(first cookie sample: %r)",
            exc,
            normalized[0] if normalized else None,
        )
        return 0


def cookies_meta(cookies: list[dict]) -> dict:
    """Build the non-secret metadata blob we store alongside the
    ciphertext.

    Stores: list of (name, domain, expires) tuples per cookie, plus a
    summary "domains" list. Lets the cockpit show "5 cookies from
    aircanada.com expiring 2026-06-15" without ever decrypting the
    payload. Never include values here — only names/domains.
    """
    cookie_names: list[dict] = []
    domains: set[str] = set()
    soonest_expiry: float | None = None
    for c in cookies:
        name = c.get("name")
        domain = c.get("domain")
        exp = c.get("expires")
        if not name:
            continue
        cookie_names.append(
            {
                "name": name,
                "domain": domain,
                "expires": int(exp) if isinstance(exp, (int, float)) and exp > 0 else None,
            }
        )
        if domain:
            domains.add(domain)
        if isinstance(exp, (int, float)) and exp > 0:
            soonest_expiry = exp if soonest_expiry is None else min(soonest_expiry, exp)

    return {
        "count": len(cookie_names),
        "domains": sorted(domains),
        "cookies": cookie_names,
        "soonest_expiry_unix": int(soonest_expiry) if soonest_expiry else None,
    }
