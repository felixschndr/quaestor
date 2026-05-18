import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Awaitable, Callable

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from source.api import application_secrets, auth, credentials, users
from source.api.exception_handlers import register_exception_handlers
from source.bank_handlers import FinTSHandler
from source.db import SessionLocal
from source.models.application_secret import ApplicationSecret
from source.services import session_service
from sqlalchemy import select
from sqlalchemy.orm import Session

load_dotenv()


def create_db_entries_if_not_exists(db_session: Session) -> None:
    objects_to_create = [ApplicationSecret(name=FinTSHandler.PRODUCT_ID_SECRET_NAME, value="")]

    for object_to_create in objects_to_create:
        model = type(object_to_create)
        unique_column_of_model = next(col.name for col in model.__table__.columns if col.unique)

        already_exists = db_session.execute(
            select(model).where(
                getattr(model, unique_column_of_model) == getattr(object_to_create, unique_column_of_model)
            )
        ).first()
        if not already_exists:
            logging.info(f"Adding {object_to_create} to the database as it does not exist yet.")
            db_session.add(object_to_create)

    db_session.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator:
    _route_third_party_loggers_to_root()
    with SessionLocal() as db_session:
        create_db_entries_if_not_exists(db_session)
    yield


class _RenameUvicornError(logging.Filter):
    """
    Rename uvicorn logs for all non-access messages from `uvicorn.error` to `uvicorn`
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name == "uvicorn.error":
            record.name = "uvicorn"
        if record.name == "uvicorn.access":
            record.name = "HTTP Request"
        return True


def _route_third_party_loggers_to_root() -> None:
    for name in logging.root.manager.loggerDict:
        if name.startswith("uvicorn"):
            third_party_logger = logging.getLogger(name)
            third_party_logger.handlers.clear()
            third_party_logger.propagate = True


def setup_logging() -> None:
    logging.basicConfig(
        stream=sys.stdout,
        format="[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s",
        encoding="utf-8",
        level=os.environ.get(key="LOG_LEVEL", default="INFO"),
        force=True,
    )
    for handler in logging.root.handlers:
        handler.addFilter(_RenameUvicornError())


setup_logging()

app = FastAPI(title="Finanzguru Clone", lifespan=lifespan)


@app.middleware("http")
async def refresh_session(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    raw_token = request.cookies.get(session_service.COOKIE_NAME)
    if raw_token:
        with SessionLocal() as db_session:
            if session_service.renew_session(db_session=db_session, raw_token=raw_token) is None:
                session_service.clear_session_cookie(response)
            else:
                session_service.set_session_cookie(response=response, raw_token=raw_token)
    return response


for api_object in [application_secrets, auth, credentials, users]:
    app.include_router(api_object.router)
register_exception_handlers(app)
