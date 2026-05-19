import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
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
        raise exception_type(f"boom: {case}")

    return TestClient(app)


@pytest.mark.parametrize(argnames="case", argvalues=list(CASES))
def test_known_exceptions_map_to_status_code_and_detail(client: TestClient, case: str):
    _, expected_status = CASES[case]

    response = client.get(f"/raise/{case}")

    assert response.status_code == expected_status
    assert response.json() == {"detail": f"boom: {case}"}


def test_unmapped_exception_is_not_swallowed(client: TestClient):
    @client.app.get("/raise-unmapped")
    def raise_unmapped() -> None:
        raise RuntimeError("unhandled")

    with pytest.raises(RuntimeError, match="unhandled"):
        client.get("/raise-unmapped")
