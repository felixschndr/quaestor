from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from httpx import Response
from starlette.responses import Response as StarletteResponse
from starlette.types import Scope

from source.backend import main
from source.backend.security import csrf
from tests.backend.conftest import register


def _request_to(path: str) -> Request:
    request = MagicMock(spec=Request)
    request.url.path = path
    return request


def _get_session_set_cookies(response: Response) -> list[str]:
    return [cookie for cookie in response.headers.get_list("set-cookie") if cookie.startswith("session=")]


def _get_csrf_set_cookies(response: Response) -> list[str]:
    return [cookie for cookie in response.headers.get_list("set-cookie") if cookie.startswith(f"{csrf.COOKIE_NAME}=")]


def test_public_static_asset_is_cacheable(http_client: TestClient):
    response = http_client.get("/static/banks/manual.png")

    assert response.status_code == 200
    cache_control = response.headers.get(key="cache-control")
    assert "max-age=86400" in cache_control
    assert "no-store" not in cache_control


def test_public_static_asset_does_not_set_csrf_cookie(http_client: TestClient):
    http_client.cookies.delete(csrf.COOKIE_NAME)

    response = http_client.get("/static/banks/manual.png")

    assert _get_csrf_set_cookies(response) == []
    assert "no-store" not in response.headers.get(key="cache-control")


def test_static_response_does_not_set_session_cookie(http_client: TestClient):
    register(http_client)

    response = http_client.get("/")

    assert _get_session_set_cookies(response) == []


def test_api_response_refreshes_session_cookie(http_client: TestClient):
    register(http_client)

    response = http_client.get("/api/auth/me")

    assert _get_session_set_cookies(response)


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


@pytest.mark.anyio
async def test_cache_middleware_marks_api_responses_no_store():
    async def call_next(_request: Request) -> StarletteResponse:  # noqa: ASYNC124
        return StarletteResponse(content=b"{}", media_type="application/json")

    response = await main.prevent_caching_of_sensitive_responses(
        request=_request_to("/api/anything"), call_next=call_next
    )

    assert response.headers["cache-control"] == "no-store"


@pytest.mark.anyio
async def test_cache_middleware_marks_cookie_setting_responses_no_store():
    async def call_next(_request: Request) -> StarletteResponse:  # noqa: ASYNC124
        response = StarletteResponse(content=b"hello world")
        response.set_cookie(key="session", value="token")
        return response

    response = await main.prevent_caching_of_sensitive_responses(request=_request_to("/"), call_next=call_next)

    assert response.headers["cache-control"] == "no-store"


@pytest.mark.anyio
async def test_cache_middleware_leaves_plain_static_responses_cacheable():
    async def call_next(_request: Request) -> StarletteResponse:  # noqa: ASYNC124
        return StarletteResponse(content=b"asset")  # a static asset, no cookie

    response = await main.prevent_caching_of_sensitive_responses(
        request=_request_to("/assets/app.js"), call_next=call_next
    )

    assert "cache-control" not in response.headers


def test_cache_control_middleware_runs_outside_the_cookie_setters():
    names = [mw.kwargs.get("dispatch").__name__ for mw in main.app.user_middleware if mw.kwargs.get("dispatch")]
    guard = names.index("prevent_caching_of_sensitive_responses")

    assert guard < names.index("refresh_session")
    assert guard < names.index("csrf_middleware")
