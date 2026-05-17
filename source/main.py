from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from source.api import application_secrets, credentials, users
from source.api.exception_handlers import register_exception_handlers
from source.bank_handlers import FinTSHandler
from source.db import SessionLocal
from source.models.application_secret import ApplicationSecret
from sqlalchemy import select
from sqlalchemy.orm import Session


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
            print(f"Adding {object_to_create} to the database")
            session.add(object_to_create)

    session.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator:
    with SessionLocal() as session:
        create_db_entries_if_not_exists(session)
    yield


app = FastAPI(title="Finanzguru Clone", lifespan=lifespan)
for api_object in [application_secrets, credentials, users]:
    app.include_router(api_object.router)
register_exception_handlers(app)
