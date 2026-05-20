# Run with RUN_E2E=1 poetry run pytest tests/test_e2e.py -s


import json
import os

import pytest
from dotenv import load_dotenv
from requests import Response, Session
from source.backend.bank_handlers import FinTSHandler

pytestmark = pytest.mark.skipif(
    not os.environ.get("RUN_E2E"),
    reason="End-to-end test",
)

URL = "http://localhost:8000"
USER1_NAME = "supercoolusername"
USER1_PW = "1234567890534345Aa!"  # nosec B105


def make_request_and_send_response(data_of_request: dict, _http_session: Session) -> Response:
    print(f"Request: {data_of_request}")

    method = data_of_request.pop("method").lower()
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


def test_e2e_full_flow() -> None:
    load_dotenv()
    http_session = Session()

    data = {
        "method": "POST",
        "url": f"{URL}/register",
        "json": {"user_name": USER1_NAME, "display_name": "My first user", "password": USER1_PW},
    }
    make_request_and_send_response(data, http_session)

    data = {
        "method": "POST",
        "url": f"{URL}/register",
        "json": {
            "user_name": "second_user",
            "display_name": "Second User",
            "password": "45678987655678Aa!",  # nosec B106
        },
    }
    response = make_request_and_send_response(data, Session())
    second_user_id = response.json()["id"]

    data = {"method": "PATCH", "url": f"{URL}/users/{second_user_id}/elevate"}
    make_request_and_send_response(data, http_session)

    data = {
        "method": "POST",
        "url": f"{URL}/application_secrets",
        "json": {"name": FinTSHandler.PRODUCT_ID_SECRET_NAME, "value": os.environ["FINTS_PRODUCT_NUMBER"]},
    }
    make_request_and_send_response(data, http_session)

    data = {"method": "GET", "url": f"{URL}/application_secrets"}
    make_request_and_send_response(data, http_session)

    data = {"method": "GET", "url": f"{URL}/credentials/list_all_possible"}
    make_request_and_send_response(data, http_session)

    data = {
        "method": "POST",
        "url": f"{URL}/credentials",
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

    data = {"method": "POST", "url": f"{URL}/credentials/{trade_republic_credential_id}/sync"}
    response = make_request_and_send_response(data, http_session)
    trade_republic_challenge_token = response.json()["challenge_token"]

    code = input("2FA-Code: ")
    data = {
        "method": "POST",
        "url": f"{URL}/credentials/{trade_republic_credential_id}/sync/2fa",
        "json": {"challenge_token": trade_republic_challenge_token, "code": code},
    }
    make_request_and_send_response(data, http_session)

    data = {
        "method": "POST",
        "url": f"{URL}/credentials",
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

    data = {"method": "POST", "url": f"{URL}/credentials/{ing_credential_id}/sync"}
    make_request_and_send_response(data, http_session)

    data = {
        "method": "POST",
        "url": f"{URL}/credentials",
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

    data = {"method": "POST", "url": f"{URL}/credentials/{dfs_credential_id}/sync"}
    make_request_and_send_response(data, http_session)

    data = {"method": "GET", "url": f"{URL}/users"}
    response = make_request_and_send_response(data, http_session)

    for credential in response.json()[0]["credentials"]:
        for account in credential["accounts"]:
            data = {"method": "GET", "url": f"{URL}/account/{account['id']}/history"}
            make_request_and_send_response(data, http_session)

    auth_client = Session()
    data = {"method": "POST", "url": f"{URL}/login", "json": {"name": USER1_NAME, "password": USER1_PW}}
    make_request_and_send_response(data, auth_client)

    data = {"method": "POST", "url": f"{URL}/logout"}
    make_request_and_send_response(data, auth_client)
