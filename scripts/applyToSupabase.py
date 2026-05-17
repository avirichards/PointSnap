#!/usr/bin/env python3
"""Apply scripts/bootstrap.sql to the Supabase project via the Management API.

Same role as scripts/applyBootstrap.ts on the Neon path, but routed through
the Supabase Management API (HTTPS, port 443) instead of the Neon REST
driver — required because this sandbox blocks 5432/6543.

Reads SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF from .env.local. Splits
bootstrap.sql on Drizzle's `--> statement-breakpoint` marker and POSTs each
statement to /v1/projects/{ref}/database/query. After success, records both
existing migration versions in supabase_migrations.schema_migrations so the
GitHub-integration auto-apply path knows the DB is at HEAD.

Usage:
    python3 scripts/applyToSupabase.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path


def load_env(env_path: Path) -> None:
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip().strip('"').strip("'")
        os.environ.setdefault(k.strip(), v)


def post_query(project_ref: str, token: str, sql: str, max_retries: int = 5) -> dict | list:
    url = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
    body = json.dumps({"query": sql}).encode("utf-8")
    last_err = None
    for attempt in range(max_retries):
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "pointsnap-bootstrap/1.0 (+https://github.com/avirichards/PointSnap)",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body_str = e.read().decode("utf-8", errors="replace")
            last_err = RuntimeError(f"HTTP {e.code}: {body_str}")
            if e.code == 429:
                backoff = (attempt + 1) * 2.0
                print(f"    429 rate-limited, sleeping {backoff}s…")
                time.sleep(backoff)
                continue
            raise last_err from None
    raise last_err  # type: ignore[misc]


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    load_env(repo_root / ".env.local")

    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    project_ref = os.environ.get("SUPABASE_PROJECT_REF")
    if not token or not project_ref:
        print("FATAL: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF must be set in .env.local")
        return 1

    bootstrap = (repo_root / "scripts" / "bootstrap.sql").read_text()
    statements = [
        s.strip()
        for s in bootstrap.split("--> statement-breakpoint")
        if s.strip() and not all(line.strip().startswith("--") or not line.strip() for line in s.splitlines())
    ]

    print(f"Applying {len(statements)} statements to project {project_ref}")
    start = time.time()
    skipped = 0
    for i, stmt in enumerate(statements, 1):
        preview = " ".join(stmt.split())[:80]
        print(f"  [{i:>3}/{len(statements)}] {preview}…")
        try:
            post_query(project_ref, token, stmt)
        except RuntimeError as e:
            msg = str(e).lower()
            # Idempotent re-run: skip statements for objects that already exist.
            # The Drizzle-generated CREATE TYPE / CREATE TABLE / CREATE INDEX
            # statements lack IF NOT EXISTS, so a partial prior run leaves us
            # needing to no-op past them on a resume.
            if any(s in msg for s in ("already exists", "duplicate object")):
                skipped += 1
                print(f"      ↳ already exists, skipping")
                continue
            print(f"\nFAIL at statement {i}: {e}")
            print(f"--- statement ---\n{stmt}\n-----------------")
            return 1
        # Throttle: Management API rate-limits at ~60 req/min
        time.sleep(0.15)
    print(f"✓ bootstrap applied in {time.time() - start:.1f}s (skipped {skipped} already-existing)")

    # Record the existing migration files in supabase_migrations.schema_migrations
    # so GitHub-integration's apply step skips them on next push (they're at HEAD).
    versions = sorted(
        p.name.split("_", 1)[0]
        for p in (repo_root / "supabase" / "migrations").glob("*.sql")
    )
    track_sql = f"""
        CREATE SCHEMA IF NOT EXISTS supabase_migrations;
        CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
            version text PRIMARY KEY,
            statements text[],
            name text
        );
        INSERT INTO supabase_migrations.schema_migrations (version)
        VALUES {', '.join(f"('{v}')" for v in versions)}
        ON CONFLICT (version) DO NOTHING;
    """
    print(f"Recording {len(versions)} migration versions in tracking table…")
    post_query(project_ref, token, track_sql)

    counts = post_query(
        project_ref,
        token,
        """
        SELECT
            (SELECT COUNT(*)::int FROM information_schema.tables
                WHERE table_schema='public' AND table_type='BASE TABLE') AS public_tables,
            (SELECT COUNT(*)::int FROM supabase_migrations.schema_migrations) AS recorded_versions
        """,
    )
    print(f"✓ Final: {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
