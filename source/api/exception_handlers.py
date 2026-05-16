from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from source.exceptions import (
    AccountNotFoundError,
    ApplicationSecretNotFoundError,
    CredentialNotFoundError,
    UserNotFoundError,
)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(UserNotFoundError)
    def _user_not_found(_request: Request, exc: UserNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(CredentialNotFoundError)
    def _credential_not_found(_request: Request, exc: CredentialNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(AccountNotFoundError)
    def _account_not_found(_request: Request, exc: AccountNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(ApplicationSecretNotFoundError)
    def _application_secret_not_found(_request: Request, exc: ApplicationSecretNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})
