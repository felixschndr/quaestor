from fastapi import FastAPI
from source.api import accounts, users
from source.api.exception_handlers import register_exception_handlers

app = FastAPI(title="Finanzguru Clone")
app.include_router(users.router)
app.include_router(accounts.router)
register_exception_handlers(app)
