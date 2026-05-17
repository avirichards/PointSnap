"""FastAPI bridge — Next.js cockpit calls this to run a plugin.

The Next.js `/api/search` route fans out per-program; for `VS_FLYING_CLUB`
it hits this app at `${PYTHON_WORKER_URL}/search?…` instead of the mock
generator. Plugin selection is keyed by the `program` query param.
"""

from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(title="pointsnap-workers", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# /search lands in commit 4 once the VS plugin + DB writeback are in place.
