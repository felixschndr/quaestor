import pytest

from source.backend.exceptions import UnknownInternalError
from source.backend.rest_api_client import RestAPIClient
from tests.backend.conftest import FakeHttpResponse


class _NonJsonResponse(FakeHttpResponse):
    def json(self) -> object:
        raise ValueError("Expecting value: line 1 column 1 (char 0)")


def test_non_json_response_raises_controlled_error(monkeypatch: pytest.MonkeyPatch) -> None:
    client = RestAPIClient(name="TestAPI", base_url="https://example.invalid")
    monkeypatch.setattr(
        target=client.http,
        name="request",
        value=lambda **kwargs: _NonJsonResponse(text="<html>gateway error</html>"),
    )

    with pytest.raises(UnknownInternalError, match="TestAPI GET /thing returned non-JSON"):
        client.get("/thing")
