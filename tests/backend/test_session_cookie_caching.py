from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from source.backend import main
from source.backend.security import csrf
from starlette.types import Scope

from tests.backend.conftest import USER_NAME, login_as, register


def _get_session_set_cookies(response: Response) -> list[str]:
    return [cookie for cookie in response.headers.get_list("set-cookie") if cookie.startswith("session=")]


def test_static_response_does_not_set_session_cookie(http_client: TestClient):
    register(http_client)

    response = http_client.get("/")

    assert _get_session_set_cookies(response) == []


def test_api_response_refreshes_session_cookie(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/auth/me")

    assert _get_session_set_cookies(response)


def test_login_response_is_not_cacheable(http_client: TestClient):
    register(http_client)

    response = login_as(http_client=http_client, user_name=USER_NAME)

    assert "no-store" in response.headers.get(key="cache-control")


def test_authenticated_api_response_is_not_cacheable(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/auth/me")

    assert "no-store" in response.headers.get(key="cache-control")


def test_static_response_that_sets_a_cookie_is_not_cacheable(http_client: TestClient):
    # Drop the csrf cookie so the csrf middleware re-issues it on the next response.
    http_client.cookies.delete(csrf.COOKIE_NAME)

    response = http_client.get("/")

    assert response.headers.get_list("set-cookie")
    assert "no-store" in response.headers.get(key="cache-control")


@pytest.mark.anyio
async def test_spa_shell_is_not_cacheable(tmp_path: Path):
    (tmp_path / "index.html").write_text("<html>spa</html>")
    spa = main._SpaStaticFiles(directory=str(tmp_path), html=True)
    scope: Scope = {"type": "http", "method": "GET", "headers": [], "path": "/deep/route"}

    response = await spa.get_response(path="deep/route", scope=scope)

    assert "no-cache" in response.headers.get("cache-control")


@pytest.mark.anyio
async def test_hashed_assets_are_cacheable(tmp_path: Path):
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "app-abc123.js").write_text("console.log('hi')")
    spa = main._SpaStaticFiles(directory=str(tmp_path), html=True)
    scope: Scope = {"type": "http", "method": "GET", "headers": [], "path": "/assets/app-abc123.js"}

    response = await spa.get_response(path="assets/app-abc123.js", scope=scope)

    cache_control = response.headers.get(key="cache-control")
    assert "immutable" in cache_control
    assert "no-store" not in cache_control
