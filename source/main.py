from fastapi import FastAPI
from source.api import application_secrets, credentials, users
from source.api.exception_handlers import register_exception_handlers

app = FastAPI(title="Finanzguru Clone")
for api_object in [application_secrets, credentials, users]:
    app.include_router(api_object.router)
register_exception_handlers(app)
