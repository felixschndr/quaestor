import asyncio
import logging
from collections.abc import Callable
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest
from fastapi import Request
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope

from source.backend import helpers, main
from source.backend.helpers import get_project_name, get_project_version
from source.backend.services.contracts import contract_overdue_scheduler
from source.backend.services.notifications import digest_scheduler
from source.backend.services.transactions import recurring_transaction_scheduler
from tests.backend.conftest import assert_log_contains


def test_log_startup_version_logs_name_and_version(caplog: pytest.LogCaptureFixture):
    main.log_startup_version()

    message = caplog.records[-1].getMessage()
    assert message == f"Starting {get_project_name()} {get_project_version()}"
    assert get_project_version() in message


@pytest.mark.parametrize(
    argnames="input_name, expected_name",
    argvalues=[("uvicorn.error", "uvicorn"), ("anything.else", "anything.else")],
)
def test_rename_uvicorn_error_filter(input_name: str, expected_name: str):
    record = logging.LogRecord(
        name=input_name,
        level=logging.INFO,
        pathname=__file__,
        lineno=0,
        msg="boot",
        args=(),
        exc_info=None,
    )

    assert main._RenameUvicornError().filter(record) is True
    assert record.name == expected_name


@pytest.mark.parametrize(
    argnames="raw, content_type, expected",
    argvalues=[
        (b"", "application/json", None),
        (b"{}", "text/html", None),
        (b"x" * (main.MAX_LOGGED_BODY_BYTES + 1), "application/json", None),
        (b"not-json", "application/json", None),
        (b'{"x": 1}', "application/json", {"x": 1}),
    ],
)
def test_loggable_json_body(raw: bytes, content_type: str, expected: dict | None):
    assert main._loggable_json_body(raw=raw, content_type=content_type) == expected


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

    assert_log_contains(caplog, message="Could not read request body")


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


PERIODIC_SCHEDULERS = [
    (
        recurring_transaction_scheduler,
        recurring_transaction_scheduler.run_periodic_recurring,
        "_book_due_recurring_transactions",
        "Recurring transaction booking run crashed",
    ),
    (
        contract_overdue_scheduler,
        contract_overdue_scheduler.run_periodic_overdue_check,
        "_evaluate_overdue_contracts",
        "Overdue contract check run crashed",
    ),
    (
        digest_scheduler,
        digest_scheduler.run_periodic_digest,
        "_evaluate_digests",
        "Digest run crashed",
    ),
]


@pytest.mark.parametrize(argnames="module, run, job_name, error_message", argvalues=PERIODIC_SCHEDULERS)
def test_periodic_scheduler_runs_its_job_and_logs_crashes(
    module: object,
    run: Callable,
    job_name: str,
    error_message: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    class _StopLoop(Exception):
        pass

    job = Mock(side_effect=RuntimeError("job failed"))
    monkeypatch.setattr(target=module, name=job_name, value=job)

    async def fake_sleep(_seconds: float) -> None:  # noqa: ASYNC124
        raise _StopLoop

    monkeypatch.setattr(target=helpers.asyncio, name="sleep", value=fake_sleep)

    with pytest.raises(_StopLoop):
        asyncio.run(run())

    job.assert_called_once_with()
    assert_log_contains(caplog, message=error_message)
