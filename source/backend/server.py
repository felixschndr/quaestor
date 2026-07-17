import os
from datetime import timedelta

import uvicorn

from source.backend.logging_utils import get_logger
from source.backend.main import app

logger = get_logger("main")

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_FORWARDED_ALLOW_IPS = "127.0.0.1"
GRACEFUL_SHUTDOWN_TIMEOUT = timedelta(seconds=5)


def _ssl_options() -> dict:
    certfile = os.environ.get("SSL_CERTFILE")
    keyfile = os.environ.get("SSL_KEYFILE")
    if certfile and keyfile:
        logger.info(f'HTTPS enabled ("{certfile}" and "{keyfile}")')
        return {"ssl_certfile": certfile, "ssl_keyfile": keyfile}
    if certfile or keyfile:
        raise RuntimeError("HTTPS requires both SSL_CERTFILE and SSL_KEYFILE to be set")
    logger.info("HTTPS disabled (SSL_CERTFILE/SSL_KEYFILE not set), serving plain HTTP")
    return {}


def uvicorn_options() -> dict:
    return {
        "host": os.environ.get(key="HOST", default=DEFAULT_HOST),
        "port": int(os.environ.get(key="PORT", default=DEFAULT_PORT)),
        "proxy_headers": True,
        "forwarded_allow_ips": os.environ.get(key="FORWARDED_ALLOW_IPS", default=DEFAULT_FORWARDED_ALLOW_IPS),
        "ws_ping_interval": None,
        "ws_ping_timeout": None,
        "timeout_graceful_shutdown": int(GRACEFUL_SHUTDOWN_TIMEOUT.total_seconds()),
        **_ssl_options(),
    }


def run() -> None:
    options = uvicorn_options()
    uvicorn.run(app, **options)


if __name__ == "__main__":
    run()
