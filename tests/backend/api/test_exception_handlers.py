import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from source.backend.api.core.exception_handlers import register_exception_handlers
from source.backend.exceptions import (
    InvalidCredentialsError,
    PermissionDeniedError,
    UnknownInternalError,
    UserNotFoundError,
    ValidationError,
)
from tests.backend.conftest import assert_log_contains

CASES = {
    "validation": (ValidationError, 422),
    "invalid_credentials": (InvalidCredentialsError, 401),
    "permission_denied": (PermissionDeniedError, 403),
    "internal": (UnknownInternalError, 500),
    "user_not_found_subclass": (UserNotFoundError, 404),
}


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/raise/{case}")
    def raise_case(case: str) -> None:
        exception_type, _ = CASES[case]
        raise exception_type(f"Something went wrong: {case}")

    return TestClient(app)


@pytest.mark.parametrize(argnames="case", argvalues=list(CASES))
def test_known_exceptions_map_to_status_code_and_detail(client: TestClient, case: str):
    _, expected_status = CASES[case]

    response = client.get(f"/raise/{case}")

    assert response.status_code == expected_status
    assert response.json() == {"detail": f"Something went wrong: {case}"}


def test_unmapped_exception_is_not_swallowed(client: TestClient):
    @client.app.get("/raise-unmapped")
    def raise_unmapped() -> None:
        raise RuntimeError("unhandled")

    with pytest.raises(RuntimeError, match="unhandled"):
        client.get("/raise-unmapped")


def test_known_exception_detail_is_logged(client: TestClient, caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.WARNING):
        client.get("/raise/validation")

    assert_log_contains(caplog, messages=["ValidationError", "Something went wrong: validation"])
    assert caplog.records[-1].levelname == "WARNING"


def test_server_error_is_logged_with_a_traceback(client: TestClient, caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.ERROR):
        client.get("/raise/internal")

    assert_log_contains(caplog, messages=["UnknownInternalError", "Something went wrong: internal", "-> 500"])
    record = caplog.records[-1]
    assert record.levelname == "ERROR"
    assert record.exc_info is not None


def test_request_validation_error_is_handled_and_logged(caplog: pytest.LogCaptureFixture):
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/validate/{number}")
    def validate(number: int) -> None:
        return None

    client = TestClient(app)
    with caplog.at_level(logging.ERROR):
        response = client.get("/validate/not-a-number")

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert isinstance(detail, list)
    assert detail[0]["loc"] == ["path", "number"]
    assert_log_contains(caplog, messages=["RequestValidationError", "number"])
    assert caplog.records[-1].levelname == "ERROR"


def test_validation_error_does_not_log_submitted_values(caplog: pytest.LogCaptureFixture):
    app = FastAPI()
    register_exception_handlers(app)

    class Body(BaseModel):
        age: int

    @app.post("/submit")
    def submit(body: Body) -> None:
        return None

    client = TestClient(app)
    with caplog.at_level(logging.ERROR):
        response = client.post("/submit", json={"age": "super-secret-value"})

    assert response.status_code == 422
    assert "super-secret-value" not in caplog.text
