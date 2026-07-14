import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from source.backend.api.exception_handlers import register_exception_handlers
from source.backend.exceptions import (
    InvalidCredentialsError,
    PermissionDeniedError,
    UnknownInternalError,
    UserNotFoundError,
    ValidationError,
)

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

    assert "ValidationError" in caplog.text
    assert "Something went wrong: validation" in caplog.text


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
    assert "RequestValidationError" in caplog.text
    assert "number" in caplog.text


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
