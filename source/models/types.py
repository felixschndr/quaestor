import json
from typing import Any

from source.crypto import get_fernet
from sqlalchemy import Dialect, LargeBinary
from sqlalchemy.types import TypeDecorator


class EncryptedString(TypeDecorator[str]):
    impl = LargeBinary
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Dialect) -> bytes | None:
        if value is None:
            return None
        return get_fernet().encrypt(value.encode("utf-8"))

    def process_result_value(self, value: Any, dialect: Dialect) -> str | None:
        if value is None:
            return None
        return get_fernet().decrypt(bytes(value)).decode("utf-8")


class EncryptedJSON(TypeDecorator[dict]):
    impl = LargeBinary
    cache_ok = True

    def process_bind_param(self, value: dict | None, dialect: Dialect) -> bytes | None:
        return get_fernet().encrypt(json.dumps(value or {}).encode("utf-8"))

    def process_result_value(self, value: Any, dialect: Dialect) -> dict:
        if value is None:
            return {}
        return json.loads(get_fernet().decrypt(bytes(value)).decode("utf-8"))
