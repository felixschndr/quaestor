import os

import uvicorn
from source.backend.logging_utils import get_logger
from source.backend.main import app

logger = get_logger(__name__)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def _ssl_options() -> dict:
    certfile = os.environ.get("SSL_CERTFILE")
    keyfile = os.environ.get("SSL_KEYFILE")
    if certfile and keyfile:
        return {"ssl_certfile": certfile, "ssl_keyfile": keyfile}
    if certfile or keyfile:
        raise RuntimeError("HTTPS requires both SSL_CERTFILE and SSL_KEYFILE to be set")
    return {}


def uvicorn_options() -> dict:
    return {
        "host": os.environ.get(key="HOST", default=DEFAULT_HOST),
        "port": int(os.environ.get(key="PORT", default=DEFAULT_PORT)),
        **_ssl_options(),
    }


def run() -> None:
    options = uvicorn_options()
    uvicorn.run(app, **options)


if __name__ == "__main__":
    run()
