from fastapi import FastAPI
from source.api import users
from source.api.exception_handlers import register_exception_handlers
from source.db import engine
from source.models.base import Base

Base.metadata.create_all(engine)

app = FastAPI(title="Finanzguru Clone")
app.include_router(users.router)
register_exception_handlers(app)
