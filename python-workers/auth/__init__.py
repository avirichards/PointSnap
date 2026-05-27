"""Auth-capture endpoints for the T5' user-initiated login flow.

This package owns `/auth/start`, `/auth/status`, `/auth/finalize`. The
parent `serve.py` includes the router via:

    from auth.capture import router as auth_router
    app.include_router(auth_router, prefix="/auth")

See `auth/capture.py` for the endpoint logic and module-level
ACTIVE_SESSIONS state.
"""

from auth.capture import router  # re-export for convenience

__all__ = ["router"]
