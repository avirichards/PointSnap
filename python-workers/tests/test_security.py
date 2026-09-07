"""Service authentication and cross-account isolation, without browser or network."""
import os
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi.testclient import TestClient
os.environ.setdefault("PYTHONWORKERS_SKIP_DB", "1")
import serve
from auth import capture
from common import auth_session

USER = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
client = TestClient(serve.app)

@pytest.fixture(autouse=True)
def keys(monkeypatch):
    monkeypatch.setenv("POINTSNAP_WORKER_TOKEN", "test-token")
    monkeypatch.setenv("POINTSNAP_WORKER_ADMIN_TOKEN", "admin-token")

@pytest.mark.parametrize("path", ["/search", "/auth/connected", "/auth/status"])
def test_requires_service_auth(path):
    assert client.get(path).status_code == 401

def test_fails_closed_without_configuration(monkeypatch):
    monkeypatch.delenv("POINTSNAP_WORKER_TOKEN")
    assert client.get("/search").status_code == 503
    assert client.get("/health").status_code == 200

def test_diagnostics_require_separate_token():
    assert client.get("/openapi.json", headers={"Authorization": "Bearer test-token"}).status_code == 401
    assert client.get("/openapi.json", headers={"Authorization": "Bearer admin-token"}).status_code == 200

def test_identity_cannot_be_overridden_by_query():
    headers={"Authorization": "Bearer test-token", "X-PointSnap-User": USER}
    assert client.get("/auth/connected", params={"user_id": OTHER}, headers=headers).status_code == 403
    assert client.get("/auth/connected", headers={"Authorization": "Bearer test-token"}).status_code == 401

@pytest.mark.parametrize("method,path", [("GET","status"),("POST","mfa"),("POST","finalize")])
def test_session_ids_cannot_cross_accounts(monkeypatch,method,path):
    monkeypatch.setitem(capture.ACTIVE_SESSIONS, "private-session", SimpleNamespace(user_id=OTHER))
    response=client.request(method, f"/auth/{path}?session_id=private-session", headers={"Authorization":"Bearer test-token","X-PointSnap-User":USER})
    assert response.status_code == 404

def test_disconnect_reports_storage_failure(monkeypatch):
    monkeypatch.setattr(auth_session,"delete_session",AsyncMock(side_effect=RuntimeError("unavailable")))
    response=client.post(f"/auth/disconnect?user_id={USER}&program=AC_AEROPLAN",headers={"Authorization":"Bearer test-token","X-PointSnap-User":USER})
    assert response.status_code == 503

@pytest.mark.asyncio
async def test_disconnect_does_not_succeed_without_database(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError):
        await auth_session.delete_session(USER,"AC_AEROPLAN")
