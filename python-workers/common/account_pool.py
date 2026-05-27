"""Per-program account rotation for scraper plugins.

Picks the least-recently-used active account per program from the
account_pool table, marks it in-use, and returns its credentials
(loaded from Fly secrets via env vars referenced by the row). Plugins
call `release()` after the scrape with success/failure so banned-on-
401/403 accounts auto-retire.

When the DB is unavailable or has no accounts for a program, falls
back to the single-account env-var lookup so dev / personal-use flows
keep working without DB setup.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger(__name__)

# Default per-account rate limit. Programs with tighter airline-side
# throttling (CX 20-call checksum, NH 30s spacing) get smaller caps via
# OVERRIDES below.
MAX_SEARCHES_PER_HOUR_DEFAULT = 30
OVERRIDES = {
    "CX_CATHAY": 15,    # 20-call checksum window
    "NH_ANA": 8,        # ~30s spacing per ANA's session limits
    "LH_MILES_MORE": 6, # heavy Akamai escalation
}


@dataclass
class AccountCreds:
    account_id: str
    program_id: str
    username: str
    password: str


def _get_db_conn():
    """Return a psycopg connection if DATABASE_URL is set, else None."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        return None
    try:
        import psycopg
        return psycopg.connect(url, autocommit=True)
    except Exception as exc:  # noqa: BLE001
        log.warning("account_pool: psycopg connect failed: %s", exc)
        return None


def _max_per_hour(program_id: str) -> int:
    return OVERRIDES.get(program_id, MAX_SEARCHES_PER_HOUR_DEFAULT)


def acquire(program_id: str) -> Optional[AccountCreds]:
    """Reserve the next available account for this program.

    Returns None if:
      - No DB connection AND no env-var fallback creds present
      - DB has no active accounts for this program AND no env-var fallback
      - All active accounts are over their hourly rate limit
    """
    conn = _get_db_conn()
    if conn is not None:
        try:
            row = _acquire_from_db(conn, program_id)
            if row:
                return row
        except Exception as exc:  # noqa: BLE001
            log.warning("account_pool: DB acquire error: %s", exc)
        finally:
            try:
                conn.close()
            except Exception:
                pass

    # Fallback: single-account env-var lookup (dev / personal use).
    return _env_fallback(program_id)


def _acquire_from_db(conn, program_id: str) -> Optional[AccountCreds]:
    """Atomic pick-and-update: select LRU active account, bump
    last_used_at + searches_today. Skips accounts over their hourly cap."""
    cap = _max_per_hour(program_id)
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE account_pool
               SET last_used_at = now(),
                   updated_at = now(),
                   searches_today = CASE
                       WHEN hourly_window_start < now() - interval '1 hour'
                       THEN 1
                       ELSE searches_today + 1
                   END,
                   hourly_window_start = CASE
                       WHEN hourly_window_start < now() - interval '1 hour'
                       THEN now()
                       ELSE hourly_window_start
                   END
             WHERE id = (
               SELECT id FROM account_pool
                WHERE program_id = %s
                  AND status = 'active'
                  AND (
                    hourly_window_start < now() - interval '1 hour'
                    OR searches_today < %s
                  )
                ORDER BY last_used_at NULLS FIRST
                LIMIT 1
                FOR UPDATE SKIP LOCKED
             )
             RETURNING id, env_user_var, env_pass_var
            """,
            (program_id, cap),
        )
        row = cur.fetchone()
        if not row:
            return None
        account_id, env_user, env_pass = row
        user = os.environ.get(env_user)
        pwd = os.environ.get(env_pass)
        if not user or not pwd:
            log.warning(
                "account_pool: %s references missing env vars %s / %s",
                account_id, env_user, env_pass,
            )
            return None
        return AccountCreds(
            account_id=account_id,
            program_id=program_id,
            username=user,
            password=pwd,
        )


_ENV_FALLBACK_MAP = {
    "BA_AVIOS": ("BA_EXEC_CLUB_USER", "BA_EXEC_CLUB_PASS"),
    "AV_LIFEMILES": ("LM_USER", "LM_PASS"),
    "AF_FLYINGBLUE": ("FB_USER", "FB_PASS"),
    "TK_MILES_SMILES": ("TK_MS_USER", "TK_MS_PASS"),
    "NH_ANA": ("ANA_AMC_USER", "ANA_AMC_PASS"),
    "CX_CATHAY": ("CX_USER", "CX_PASS"),
    "LH_MILES_MORE": ("MM_CARD_NUM", "MM_PIN"),
    "AA_AADVANTAGE": ("AA_USER", "AA_PASS"),
    "DL_SKYMILES": ("DL_USER", "DL_PASS"),
    "AC_AEROPLAN": ("AEROPLAN_USER", "AEROPLAN_PASS"),
}


def _env_fallback(program_id: str) -> Optional[AccountCreds]:
    keys = _ENV_FALLBACK_MAP.get(program_id)
    if not keys:
        return None
    user = os.environ.get(keys[0])
    pwd = os.environ.get(keys[1])
    if not user or not pwd:
        return None
    return AccountCreds(
        account_id=f"{program_id}_ENV",
        program_id=program_id,
        username=user,
        password=pwd,
    )


def release(account_id: str, success: bool, error: str | None = None) -> None:
    """Report scrape outcome back to the pool.

    On 401/403 errors → mark the account banned so it's skipped next time.
    On success or other errors → no change beyond the last_used_at bump
    that already happened in acquire().
    """
    if account_id.endswith("_ENV"):
        return  # env-fallback accounts aren't pool-managed

    if not success and error and any(e in error for e in ("401", "403")):
        conn = _get_db_conn()
        if not conn:
            return
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE account_pool
                       SET status = 'banned',
                           banned_at = now(),
                           ban_reason = %s,
                           updated_at = now()
                     WHERE id = %s
                    """,
                    (error[:500], account_id),
                )
                log.info("account_pool: marked %s banned (%s)", account_id, error[:120])
        except Exception as exc:  # noqa: BLE001
            log.warning("account_pool: ban-mark failed for %s: %s", account_id, exc)
        finally:
            try:
                conn.close()
            except Exception:
                pass
