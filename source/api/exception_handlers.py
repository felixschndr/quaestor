from typing import Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from source.exceptions import (
    InvalidCredentialsError,
    NotFoundError,
    UnknownInternalError,
    ValidationError,
)

EXCEPTIONS_TO_CATCH_AND_THEIR_STATUS_CODES: dict[type[Exception], int] = {
    NotFoundError: 404,
    ValidationError: 422,
    InvalidCredentialsError: 401,
    UnknownInternalError: 500,
}


def register_exception_handlers(app: FastAPI) -> None:
    def make_handler(code: int) -> Callable:
        def handler(_request: Request, exc: Exception) -> JSONResponse:
            return JSONResponse(status_code=code, content={"detail": str(exc)})

        return handler

    for exc_type, status_code in EXCEPTIONS_TO_CATCH_AND_THEIR_STATUS_CODES.items():
        app.add_exception_handler(exc_type, make_handler(status_code))
