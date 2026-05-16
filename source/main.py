from fastapi import FastAPI
from source.api import credentials, users
from source.api.exception_handlers import register_exception_handlers

app = FastAPI(title="Finanzguru Clone")
app.include_router(users.router)
app.include_router(credentials.router)
register_exception_handlers(app)
