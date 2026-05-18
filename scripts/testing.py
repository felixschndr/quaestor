#!/usr/bin/env python3

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from requests import Response, Session

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from source.bank_handlers import FinTSHandler  # noqa: E402

URL = "http://localhost:8000"
USER1_NAME = "Felix"
USER1_PW = "1234567890534345Aa!"

http_session = Session()


def make_request_and_send_response(data_of_request: dict, _http_session: Session = http_session) -> Response:
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


load_dotenv()

data = {"method": "POST", "url": f"{URL}/register", "json": {"name": USER1_NAME, "password": USER1_PW}}
response = make_request_and_send_response(data)
user_id = response.json()["id"]

data = {"method": "POST", "url": f"{URL}/register", "json": {"name": "Second user", "password": "45678987655678Aa!"}}
response = make_request_and_send_response(data, _http_session=Session())
second_user_id = response.json()["id"]

data = {"method": "PATCH", "url": f"{URL}/users/{second_user_id}/elevate"}
make_request_and_send_response(data)

data = {
    "method": "POST",
    "url": f"{URL}/application_secrets",
    "json": {"name": FinTSHandler.PRODUCT_ID_SECRET_NAME, "value": os.environ["FINTS_PRODUCT_NUMBER"]},
}
make_request_and_send_response(data)

data = {"method": "GET", "url": f"{URL}/application_secrets"}
make_request_and_send_response(data)

data = {"method": "GET", "url": f"{URL}/credentials/list_all_possible"}
make_request_and_send_response(data)


data = {
    "method": "POST",
    "url": f"{URL}/credentials",
    "json": {
        "bank": "trade_republic",
        "username": os.environ["TR_PHONE"],
        "password": os.environ["TR_PIN"],
    },
}
response = make_request_and_send_response(data)
trade_republic_credential_id = response.json()["id"]

data = {"method": "POST", "url": f"{URL}/credentials/{trade_republic_credential_id}/sync"}
response = make_request_and_send_response(data)
trade_republic_challenge_token = response.json()["challenge_token"]


code = input("2FA-Code: ")
data = {
    "method": "POST",
    "url": f"{URL}/credentials/{trade_republic_credential_id}/sync/2fa",
    "json": {"challenge_token": trade_republic_challenge_token, "code": code},
}
make_request_and_send_response(data)


data = {
    "method": "POST",
    "url": f"{URL}/credentials",
    "json": {
        "bank": "ing",
        "username": os.environ["ING_USERNAME"],
        "password": os.environ["ING_PASSWORD"],
    },
}
response = make_request_and_send_response(data)
ing_credential_id = response.json()["id"]

data = {"method": "POST", "url": f"{URL}/credentials/{ing_credential_id}/sync"}
make_request_and_send_response(data)

data = {
    "method": "POST",
    "url": f"{URL}/credentials",
    "json": {
        "bank": "dfs",
        "username": os.environ["DFS_USERNAME"],
        "password": os.environ["DFS_PASSWORD"],
        "mandat": os.environ["DFS_MANDAT"],
        "customer": os.environ["DFS_CUSTOMER"],
    },
}
response = make_request_and_send_response(data)
dfs_credential_id = response.json()["id"]

data = {"method": "POST", "url": f"{URL}/credentials/{dfs_credential_id}/sync"}
make_request_and_send_response(data)

data = {"method": "GET", "url": f"{URL}/users"}
make_request_and_send_response(data)

auth_client = Session()
data = {"method": "POST", "url": f"{URL}/login", "json": {"name": USER1_NAME, "password": USER1_PW}}
make_request_and_send_response(data, _http_session=auth_client)

data = {"method": "POST", "url": f"{URL}/logout"}
make_request_and_send_response(data, _http_session=auth_client)
