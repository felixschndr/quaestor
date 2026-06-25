import asyncio
import logging
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Request
from source.backend import main
from source.backend.helpers import get_project_name, get_project_version
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope


def test_log_startup_version_logs_name_and_version(caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.INFO, logger="main"):
        main.log_startup_version()

    message = caplog.records[-1].getMessage()
    assert message == f"Starting {get_project_name()} {get_project_version()}"
    assert get_project_version() in message


def test_rename_uvicorn_error_filter_renames_uvicorn_error_records():
    record = logging.LogRecord(
        name="uvicorn.error",
        level=logging.INFO,
        pathname=__file__,
        lineno=0,
        msg="boot",
        args=(),
        exc_info=None,
    )

    assert main._RenameUvicornError().filter(record) is True
    assert record.name == "uvicorn"


def test_rename_uvicorn_error_filter_leaves_other_records_alone():
    record = logging.LogRecord(
        name="anything.else",
        level=logging.INFO,
        pathname=__file__,
        lineno=0,
        msg="boot",
        args=(),
        exc_info=None,
    )

    assert main._RenameUvicornError().filter(record) is True
    assert record.name == "anything.else"


def test_loggable_json_body_returns_none_for_empty_body():
    assert main._loggable_json_body(raw=b"", content_type="application/json") is None


def test_loggable_json_body_returns_none_for_non_json_content_type():
    assert main._loggable_json_body(raw=b"{}", content_type="text/html") is None


def test_loggable_json_body_returns_none_when_body_exceeds_size_limit():
    too_big = b"x" * (main.MAX_LOGGED_BODY_BYTES + 1)

    assert main._loggable_json_body(raw=too_big, content_type="application/json") is None


def test_loggable_json_body_returns_none_for_malformed_json():
    assert main._loggable_json_body(raw=b"not-json", content_type="application/json") is None


def test_loggable_json_body_returns_parsed_object_for_valid_json():
    assert main._loggable_json_body(raw=b'{"x": 1}', content_type="application/json") == {"x": 1}


def _log_request_with_status(status_code: int, caplog: pytest.LogCaptureFixture) -> None:
    async def runner() -> None:
        request = MagicMock(spec=Request)
        request.method = "POST"
        request.url.path = "/api/something"
        request.body = AsyncMock(return_value=b"")
        request.headers = Headers({})
        request.query_params = {}

        async def call_next(_request: Request) -> MagicMock:  # noqa: ASYNC124
            response = MagicMock()
            response.status_code = status_code
            response.media_type = "application/json"
            response.headers = Headers({})
            response.raw_headers = []

            async def body_iterator():  # noqa: ASYNC124
                for chunk in [b"{}"]:
                    yield chunk

            response.body_iterator = body_iterator()
            return response

        with caplog.at_level(logging.INFO, logger="main"):
            await main.log_http_requests(request=request, call_next=call_next)

    asyncio.run(runner())


@pytest.mark.parametrize(
    argnames="status_code, expected_loglevel", argvalues=[(200, "INFO"), (405, "WARNING"), (500, "ERROR")]
)
def test_log_http_requests_uses_correct_log_level(
    status_code: int, expected_loglevel: str, caplog: pytest.LogCaptureFixture
):
    _log_request_with_status(status_code=status_code, caplog=caplog)

    record = next(r for r in caplog.records if "-> {}".format(status_code) in r.message)
    assert record.levelname == expected_loglevel


@pytest.mark.anyio
async def test_log_http_requests_logs_when_body_read_fails(caplog: pytest.LogCaptureFixture):
    request = MagicMock(spec=Request)
    request.method = "POST"
    request.url.path = "/api/something"
    request.body = AsyncMock(side_effect=RuntimeError("connection lost"))
    request.headers = Headers({})
    request.query_params = {}

    async def call_next(_request: Request) -> MagicMock:  # noqa: ASYNC124
        response = MagicMock()
        response.status_code = 200
        response.media_type = "application/json"
        response.headers = Headers({})
        response.raw_headers = []

        async def body_iterator():  # noqa: ASYNC124
            for chunk in [b"{}"]:
                yield chunk

        response.body_iterator = body_iterator()
        return response

    with caplog.at_level(logging.DEBUG, logger="main"):
        await main.log_http_requests(request=request, call_next=call_next)

    assert any("Could not read request body" in r.message for r in caplog.records)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_spa_static_files_falls_back_to_index_html_on_missing_path(tmp_path: Path):
    index = tmp_path / "index.html"
    index.write_text("<html>spa</html>")
    spa = main._SpaStaticFiles(directory=str(tmp_path), html=True)

    scope: Scope = {
        "type": "http",
        "method": "GET",
        "headers": [],
        "path": "/missing-route",
    }

    response = await spa.get_response(path="missing-route", scope=scope)

    assert response.status_code == 200
    assert response.path == str(index)


@pytest.mark.anyio
async def test_spa_static_files_propagates_non_404_errors(tmp_path: Path):
    spa = main._SpaStaticFiles(directory=str(tmp_path), html=True)

    scope: Scope = {
        "type": "http",
        "method": "POST",
        "headers": [],
        "path": "/anything",
    }

    with pytest.raises(StarletteHTTPException) as exc_info:
        await spa.get_response(path="anything", scope=scope)

    assert exc_info.value.status_code == 405
