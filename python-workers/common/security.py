"""Fail-closed service boundary; public health reveals no account information."""
import hmac
import os
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

class WorkerSecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if path in {'/health', '/programs/meta'}:
            return await call_next(request)
        admin = path.startswith('/diag') or path in {'/docs', '/redoc', '/openapi.json'}
        key = 'POINTSNAP_WORKER_ADMIN_TOKEN' if admin else 'POINTSNAP_WORKER_TOKEN'
        expected = os.environ.get(key, '')
        if not expected:
            return JSONResponse({'detail': 'Service is not configured'}, status_code=503)
        actual = request.headers.get('authorization', '')
        if not hmac.compare_digest(actual, 'Bearer ' + expected):
            return JSONResponse({'detail': 'Unauthorized'}, status_code=401)
        user = request.headers.get('x-pointsnap-user')
        claimed = request.query_params.get('user_id')
        if path.startswith('/auth') or claimed is not None:
            try:
                uuid.UUID(user or '')
            except (ValueError, TypeError):
                return JSONResponse({'detail': 'Sign in required'}, status_code=401)
            if claimed is not None and claimed != user:
                return JSONResponse({'detail': 'Identity mismatch'}, status_code=403)
        response = await call_next(request)
        if path.startswith('/auth'):
            response.headers['Cache-Control'] = 'private, no-store'
        return response
