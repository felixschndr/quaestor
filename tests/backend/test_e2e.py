# Run with RUN_E2E=1 poetry run pytest tests/test_e2e.py -s


import json
import os

import pytest
from dotenv import load_dotenv
from requests import Response, Session

from tests.backend.conftest import DISPLAY_NAME, USER_NAME, VALID_PASSWORD

pytestmark = pytest.mark.skipif(
    not os.environ.get("RUN_E2E"),
    reason="End-to-end test",
)

URL = "http://localhost:8000"


MUTATING_METHODS = {"post", "patch", "put", "delete"}


def make_request_and_send_response(data_of_request: dict, _http_session: Session) -> Response:
    print(f"Request: {data_of_request}")

    method = data_of_request.pop("method").lower()
    if method in MUTATING_METHODS:
        csrf_token = _http_session.cookies.get("csrf_token")
        if csrf_token:
            headers = data_of_request.setdefault("headers", {})
            headers.setdefault("X-CSRF-Token", csrf_token)
    _response = getattr(_http_session, method)(**data_of_request)

    try:
        response_text = f"Response ({_response.status_code}): {json.dumps(_response.json(), indent=4)}"
    except json.JSONDecodeError:
        if _response.text:
            response_text = f"Response ({_response.status_code}): {_response.text}"
        else:
            response_text = f"Empty Response ({_response.status_code})"
    print(f"{response_text}\n\n\n")
    _response.raise_for_status()

    return _response


def _bootstrap_csrf(_http_session: Session) -> None:
    make_request_and_send_response({"method": "GET", "url": f"{URL}/api/auth/registration_allowed"}, _http_session)


def test_e2e_full_flow() -> None:
    load_dotenv()
    http_session = Session()
    _bootstrap_csrf(http_session)

    data = {
        "method": "POST",
        "url": f"{URL}/api/auth/register",
        "json": {"user_name": USER_NAME, "display_name": DISPLAY_NAME, "password": VALID_PASSWORD},
    }
    make_request_and_send_response(data, http_session)

    data = {"method": "GET", "url": f"{URL}/api/credentials/supported_banks"}
    make_request_and_send_response(data, http_session)

    data = {
        "method": "POST",
        "url": f"{URL}/api/credentials",
        "json": {
            "bank": "trade_republic",
            "credentials": {
                "phone": os.environ["TR_PHONE"],
                "pin": os.environ["TR_PIN"],
            },
        },
    }
    response = make_request_and_send_response(data, http_session)
    trade_republic_credential_id = response.json()["id"]

    data = {"method": "POST", "url": f"{URL}/api/credentials/{trade_republic_credential_id}/sync"}
    response = make_request_and_send_response(data, http_session)
    trade_republic_challenge_token = response.json()["challenge_token"]

    code = input("2FA-Code: ")
    data = {
        "method": "POST",
        "url": f"{URL}/api/credentials/{trade_republic_credential_id}/sync/2fa",
        "json": {"challenge_token": trade_republic_challenge_token, "code": code},
    }
    make_request_and_send_response(data, http_session)

    data = {
        "method": "POST",
        "url": f"{URL}/api/credentials",
        "json": {
            "bank": "ing",
            "credentials": {
                "username": os.environ["ING_USERNAME"],
                "password": os.environ["ING_PASSWORD"],
            },
        },
    }
    response = make_request_and_send_response(data, http_session)
    ing_credential_id = response.json()["id"]

    data = {"method": "POST", "url": f"{URL}/api/credentials/{ing_credential_id}/sync"}
    make_request_and_send_response(data, http_session)

    data = {
        "method": "POST",
        "url": f"{URL}/api/credentials",
        "json": {
            "bank": "dfs",
            "credentials": {
                "username": os.environ["DFS_USERNAME"],
                "password": os.environ["DFS_PASSWORD"],
                "customer": os.environ["DFS_CUSTOMER"],
            },
        },
    }
    response = make_request_and_send_response(data, http_session)
    dfs_credential_id = response.json()["id"]

    data = {"method": "POST", "url": f"{URL}/api/credentials/{dfs_credential_id}/sync"}
    make_request_and_send_response(data, http_session)

    data = {"method": "GET", "url": f"{URL}/api/auth/me"}
    response = make_request_and_send_response(data, http_session)

    for credential in response.json()["credentials"]:
        for account in credential["accounts"]:
            data = {"method": "GET", "url": f"{URL}/api/account/{account['id']}/history"}
            make_request_and_send_response(data, http_session)

    auth_client = Session()
    _bootstrap_csrf(auth_client)
    data = {
        "method": "POST",
        "url": f"{URL}/api/auth/login",
        "json": {"user_name": USER_NAME, "password": VALID_PASSWORD},
    }
    make_request_and_send_response(data, auth_client)

    data = {"method": "POST", "url": f"{URL}/api/auth/logout"}
    make_request_and_send_response(data, auth_client)
