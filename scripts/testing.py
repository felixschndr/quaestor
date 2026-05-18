#!/usr/bin/env python3

import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv
from requests import Response

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from source.bank_handlers import FinTSHandler  # noqa: E402

URL = "http://localhost:8000"


def print_request_and_response(sent_data: dict, response: Response) -> None:
    print("Request:", sent_data)
    try:
        response_text = f"Response ({response.status_code}): {json.dumps(response.json(), indent=4)}"
    except json.JSONDecodeError:
        if response.text:
            response_text = f"Response ({response.status_code}): {response.text}"
        else:
            response_text = f"Empty Response ({response.status_code})"
    print(f"{response_text}\n\n\n")
    response.raise_for_status()


load_dotenv()
data = {
    "url": f"{URL}/application_secrets",
    "json": {"name": FinTSHandler.PRODUCT_ID_SECRET_NAME, "value": os.environ["FINTS_PRODUCT_NUMBER"]},
}
r = requests.post(**data)
print_request_and_response(data, r)

data = {"url": f"{URL}/application_secrets"}
r = requests.get(**data)
print_request_and_response(data, r)

data = {"url": f"{URL}/credentials/list_all_possible"}
r = requests.get(**data)
print_request_and_response(data, r)

data = {"url": f"{URL}/users", "json": {"name": "Felix", "password": "1234567890534345Aa!"}}
r = requests.post(**data)
print_request_and_response(data, r)
user_id = r.json()["id"]

data = {"url": f"{URL}/users", "json": {"name": "Second user", "password": "45678987655678Aa!"}}
r = requests.post(**data)
print_request_and_response(data, r)
second_user_id_ = r.json()["id"]

data = {"url": f"{URL}/users/{second_user_id_}/elevate", "json": {"acting_admin_id": user_id}}
r = requests.patch(**data)
print_request_and_response(data, r)

data = {"url": f"{URL}/users/"}
r = requests.get(**data)
print_request_and_response(data, r)


data = {
    "url": f"{URL}/credentials",
    "json": {
        "user_id": user_id,
        "bank": "trade_republic",
        "username": os.environ["TR_PHONE"],
        "password": os.environ["TR_PIN"],
    },
}
r = requests.post(**data)
print_request_and_response(data, r)
credential_id = r.json()["id"]

data = {"url": f"{URL}/credentials/{credential_id}/sync"}
r = requests.post(**data)
print_request_and_response(data, r)

code = input("2FA-Code: ")
data = {
    "url": f"{URL}/credentials/{credential_id}/sync/2fa",
    "json": {"challenge_token": r.json()["challenge_token"], "code": code},
}
r = requests.post(**data)
print_request_and_response(data, r)


data = {
    "url": f"{URL}/credentials",
    "json": {
        "user_id": user_id,
        "bank": "ing",
        "username": os.environ["ING_USERNAME"],
        "password": os.environ["ING_PASSWORD"],
    },
}
r = requests.post(**data)
print_request_and_response(data, r)
credential_id = r.json()["id"]

data = {"url": f"{URL}/credentials/{credential_id}/sync"}
r = requests.post(**data)
print_request_and_response(data, r)

data = {"url": f"{URL}/credentials/{credential_id}"}
r = requests.get(**data)
print_request_and_response(data, r)

data = {
    "url": f"{URL}/credentials",
    "json": {
        "user_id": user_id,
        "bank": "dfs",
        "username": os.environ["DFS_USERNAME"],
        "password": os.environ["DFS_PASSWORD"],
        "mandat": os.environ["DFS_MANDAT"],
        "customer": os.environ["DFS_CUSTOMER"],
    },
}
r = requests.post(**data)
print_request_and_response(data, r)
credential_id = r.json()["id"]

data = {"url": f"{URL}/credentials/{credential_id}/sync"}
r = requests.post(**data)
print_request_and_response(data, r)


data = {"url": f"{URL}/users/{user_id}"}
r = requests.get(**data)
print_request_and_response(data, r)
