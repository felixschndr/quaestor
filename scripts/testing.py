#!/usr/bin/env python3

import json
import os

import requests
from dotenv import load_dotenv
from requests import Response

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


load_dotenv()
ING_USERNAME = os.environ.get("ING_USERNAME", "")
ING_PASSWORD = os.environ.get("ING_PASSWORD", "")

data = {"url": f"{URL}/application_secrets", "json": {"name": "q", "value": "w"}}
r = requests.post(**data)
print_request_and_response(data, r)

data = {"url": f"{URL}/application_secrets"}
r = requests.get(**data)
print_request_and_response(data, r)

data = {"url": f"{URL}/credentials/list_all_possible"}
r = requests.get(**data)
print_request_and_response(data, r)

data = {"url": f"{URL}/users", "json": {"name": "Felix"}}
r = requests.post(**data)
print_request_and_response(data, r)
user_id = r.json()["id"]


data = {
    "url": f"{URL}/credentials",
    "json": {"user_id": user_id, "bank": "ing", "username": ING_USERNAME, "password": ING_PASSWORD},
}
r = requests.post(**data)
print_request_and_response(data, r)
credential_id = r.json()["id"]

data = {"url": f"{URL}/credentials/{credential_id}"}
r = requests.get(**data)
print_request_and_response(data, r)

data = {"url": f"{URL}/credentials/{credential_id}/sync"}
r = requests.post(**data)
print_request_and_response(data, r)

data = {"url": f"{URL}/credentials/{credential_id}"}
r = requests.get(**data)
print_request_and_response(data, r)

data = {"url": f"{URL}/users/{user_id}"}
r = requests.get(**data)
print_request_and_response(data, r)
