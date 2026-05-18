import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI
from source.api import application_secrets, credentials, users
from source.api.exception_handlers import register_exception_handlers
from source.bank_handlers import FinTSHandler
from source.db import SessionLocal
from source.models.application_secret import ApplicationSecret
from sqlalchemy import select
from sqlalchemy.orm import Session

load_dotenv()


def create_db_entries_if_not_exists(session: Session) -> None:
    objects_to_create = [ApplicationSecret(name=FinTSHandler.PRODUCT_ID_SECRET_NAME, value="")]

    for object_to_create in objects_to_create:
        model = type(object_to_create)
        unique_column_of_model = next(col.name for col in model.__table__.columns if col.unique)

        already_exists = session.execute(
            select(model).where(
                getattr(model, unique_column_of_model) == getattr(object_to_create, unique_column_of_model)
            )
        ).first()
        if not already_exists:
            logging.info(f"Adding {object_to_create} to the database as it does not exist yet.")
            session.add(object_to_create)

    session.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator:
    _route_third_party_loggers_to_root()
    with SessionLocal() as session:
        create_db_entries_if_not_exists(session)
    yield


def _add_trace_log_level() -> None:
    trace_log_level = logging.DEBUG - 5

    logging.addLevelName(trace_log_level, "TRACE")

    def trace(self, message, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN201
        if self.isEnabledFor(trace_log_level):
            self._log(trace_log_level, message, args, **kwargs)

    logging.Logger.trace = trace


class _RenameUvicornError(logging.Filter):
    """
    Rename uvicorn logs for all non-access messages from `uvicorn.error` to `uvicorn`
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name == "uvicorn.error":
            record.name = "uvicorn"
        if record.name == "uvicorn.access":
            record.name = "HTTP Request"
        record.name = record.name[0].upper() + record.name[1:]
        return True


def _route_third_party_loggers_to_root() -> None:
    for name in logging.root.manager.loggerDict:
        if name.startswith("uvicorn"):
            third_party_logger = logging.getLogger(name)
            third_party_logger.handlers.clear()
            third_party_logger.propagate = True


def setup_logging() -> None:
    _add_trace_log_level()
    logging.basicConfig(
        stream=sys.stdout,
        format="[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s",
        encoding="utf-8",
        level=os.environ.get("LOG_LEVEL", "INFO"),
        force=True,
    )
    for handler in logging.root.handlers:
        handler.addFilter(_RenameUvicornError())


setup_logging()

app = FastAPI(title="Finanzguru Clone", lifespan=lifespan)
for api_object in [application_secrets, credentials, users]:
    app.include_router(api_object.router)
register_exception_handlers(app)
