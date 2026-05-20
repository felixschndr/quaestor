import asyncio
import json
import logging
import os
import sys
from contextlib import asynccontextmanager, suppress
from typing import Any, AsyncGenerator, Awaitable, Callable

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from source.backend.api import (
    account,
    application_secrets,
    auth,
    credentials,
    users,
)
from source.backend.api.exception_handlers import register_exception_handlers
from source.backend.bank_handlers import FinTSHandler
from source.backend.db import SessionLocal, log_database_location
from source.backend.logging_utils import get_logger, redact_headers
from source.backend.models.application_secret import ApplicationSecret
from source.backend.services import session_service, sync_scheduler
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

MAX_LOGGED_BODY_BYTES = 4096

load_dotenv()


def create_db_entries_if_not_exists(db_session: Session) -> None:
    objects_to_create = [
        ApplicationSecret(name=FinTSHandler.PRODUCT_ID_SECRET_NAME, value=""),
    ]
    logger.debug(f"Creating {len(objects_to_create)} default object(s) into the database if missing")

    for object_to_create in objects_to_create:
        model = type(object_to_create)
        unique_column_of_model = next(col.name for col in model.__table__.columns if col.unique)

        already_exists = db_session.execute(
            select(model).where(
                getattr(model, unique_column_of_model) == getattr(object_to_create, unique_column_of_model)
            )
        ).first()
        if not already_exists:
            logger.info(f"Adding {object_to_create} to the database as it does not exist yet.")
            db_session.add(object_to_create)
        else:
            logger.debug(f"Skipping creations for {object_to_create} (already exists)")

    db_session.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator:
    _route_third_party_loggers_to_root()
    log_database_location()
    with SessionLocal() as db_session:
        create_db_entries_if_not_exists(db_session)
    sync_task = asyncio.create_task(sync_scheduler.run_periodic_sync())
    try:
        yield
    finally:
        sync_task.cancel()
        with suppress(asyncio.CancelledError):
            await sync_task
        logger.info("Shutdown complete")


class _RenameUvicornError(logging.Filter):
    """
    Rename uvicorn logs for all non-access messages from `uvicorn.error` to `uvicorn`
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name == "uvicorn.error":
            record.name = "uvicorn"
        return True


def _route_third_party_loggers_to_root() -> None:
    for name in logging.root.manager.loggerDict:
        if name.startswith("uvicorn"):
            third_party_logger = logging.getLogger(name)
            third_party_logger.handlers.clear()
            # The log_requests middleware logs every request itself, so the
            # uvicorn access log would only be a duplicate.
            if name == "uvicorn.access":
                third_party_logger.disabled = True
                third_party_logger.propagate = False
            else:
                third_party_logger.propagate = True


def setup_logging() -> None:
    log_level = os.environ.get(key="LOG_LEVEL", default="INFO")
    logging.basicConfig(
        stream=sys.stdout,
        format="[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s",
        encoding="utf-8",
        level=log_level,
        force=True,
    )
    for handler in logging.root.handlers:
        handler.addFilter(_RenameUvicornError())
    logger.debug(f"Logging configured at level {log_level}")


setup_logging()

app = FastAPI(title="Finanzguru Clone", lifespan=lifespan)


@app.middleware("http")
async def refresh_session(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    raw_token = request.cookies.get(session_service.COOKIE_NAME)
    if not raw_token:
        logger.debug(f"{request.method} {request.url.path}: no session cookie, skipping session refresh")
        return response
    with SessionLocal() as db_session:
        user_session = session_service.renew_session(db_session=db_session, raw_token=raw_token)
        if user_session is None:
            logger.debug(
                f"{request.method} {request.url.path}: presented session cookie is invalid or expired, "
                "clearing it from the response"
            )
            session_service.clear_session_cookie(response)
        else:
            logger.debug(f"{request.method} {request.url.path}: refreshed {user_session}")
            session_service.set_session_cookie(
                response=response, raw_token=raw_token, remember_me=user_session.remember_me
            )
    return response


def _loggable_json_body(raw: bytes, content_type: str) -> Any:
    if not raw or "application/json" not in content_type or len(raw) > MAX_LOGGED_BODY_BYTES:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


@app.middleware("http")
async def log_http_requests(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    log_level_is_debug = logging.getLogger(__name__).isEnabledFor(logging.DEBUG)

    request_body = b""
    if log_level_is_debug:
        try:
            request_body = await request.body()
        except Exception as e:
            logger.debug(f"Could not read request body for {request.method} {request.url.path}: {e}")
            request_body = b""

    response = await call_next(request)
    summary = f"{request.method} {request.url.path} -> {response.status_code}"

    if not log_level_is_debug:
        logger.info(summary)
        return response

    response_body = b"".join([chunk async for chunk in response.body_iterator])
    rebuilt = Response(content=response_body, status_code=response.status_code, media_type=response.media_type)
    rebuilt.raw_headers = response.raw_headers

    extra = {
        "request": {
            "query": dict(request.query_params),
            "headers": redact_headers(dict(request.headers)),
            "body": _loggable_json_body(
                raw=request_body, content_type=request.headers.get(key="content-type", default="")
            ),
        },
        "response": {
            "headers": redact_headers(dict(response.headers)),
            "body": _loggable_json_body(
                raw=response_body, content_type=response.headers.get(key="content-type", default="")
            ),
        },
    }
    logger.info(summary, extra=extra)
    return rebuilt


API_PREFIX = "/api"

for api_object in [account, application_secrets, auth, credentials, users]:
    app.include_router(api_object.router, prefix=API_PREFIX)
register_exception_handlers(app)
