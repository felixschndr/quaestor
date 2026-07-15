from requests import HTTPError, Response, Session

from source.backend.constants import HTTP_TIMEOUT
from source.backend.exceptions import UnknownInternalError


class RestAPIClient:
    def __init__(self, name: str, base_url: str):
        self.name = name
        self.http = Session()
        self._base_url = base_url

    def request(
        self,
        method: str,
        path: str,
        json_body: dict | None = None,
        params: dict | None = None,
        data: dict | None = None,
    ) -> Response:
        return self.http.request(
            method=method,
            url=f"{self._base_url}{path}",
            json=json_body,
            data=data,
            params=params,
            timeout=HTTP_TIMEOUT.total_seconds(),
        )

    def get(self, path: str, params: dict | None = None) -> dict:
        return self._parse_json(response=self.request(method="GET", path=path, params=params), label=f"GET {path}")

    def post(self, path: str, json_body: dict | None = None) -> dict:
        return self._parse_json(
            response=self.request(method="POST", path=path, json_body=json_body), label=f"POST {path}"
        )

    def raise_for_status(self, response: Response, label: str) -> None:
        try:
            response.raise_for_status()
        except HTTPError as e:
            raise UnknownInternalError(f"{self.name} {label}: {e}: {response.text}") from e

    def _parse_json(self, response: Response, label: str) -> dict:
        self.raise_for_status(response=response, label=f"{label} failed")
        try:
            return response.json()
        except ValueError as e:
            raise UnknownInternalError(f"{self.name} {label} returned non-JSON: {response.text[:200]}") from e
