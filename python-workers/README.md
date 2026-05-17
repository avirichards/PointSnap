# pointsnap-workers

Python scraper workers for PointSnap. Each launch program gets its own plugin
exporting an async `search()` returning normalized rows; a FastAPI bridge
(`serve.py`) wraps the plugins so the Next.js cockpit at `/api/search` can
fan out to them via HTTPS.

## Layout

```
python-workers/
  serve.py          FastAPI app — GET /search?program=…&origin=…&dest=…&date=…
  common/
    types.py        NormalizedResult + segment + cabin-price dataclasses (mirror SearchResultRow on the JS side)
    hash.py         Python port of src/lib/itineraryHash.ts — must produce identical SHA256
    db.py           Postgres writeback (psycopg, idempotent on results_itin_uniq)
  vs/
    search.py       Virgin Atlantic Flying Club plugin
  tests/
```

## Day-1 status (this branch)

VS plugin returns a **hard-coded** JFK→LHR response so we can prove the
worker → DB → SSE → cockpit pipeline. No real scraping, no proxies, no
captcha solving — those land in session 5.

## Local dev

```bash
cd python-workers
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp ../.env.local .env   # need DATABASE_URL — Neon connection string
uvicorn serve:app --port 8001 --reload
```

Smoke test:

```bash
curl 'http://localhost:8001/search?program=VS_FLYING_CLUB&origin=JFK&dest=LHR&date=2026-06-15' | jq
```

**Caveat for this Claude Code sandbox:** outbound TCP 5432 is blocked, so
DB writeback fails locally. Run with `PYTHONWORKERS_SKIP_DB=1` to return
the plugin result without persisting. On Fly.io (production) 5432 is open.

## Production target — Fly.io

`fly.toml` + `Dockerfile` deploy the bridge as a small always-on app.
Vercel functions hit it at `${PYTHON_WORKER_URL}/search?…`. See
`docs/handoff/SESSION-4-START.md` for the per-session rollout plan.
