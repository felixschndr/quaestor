from typing import Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from source.backend.exceptions import (
    InvalidCredentialsError,
    NotFoundError,
    PermissionDeniedError,
    UnknownInternalError,
    ValidationError,
)
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

EXCEPTIONS_TO_CATCH_AND_THEIR_STATUS_CODES: dict[type[Exception], int] = {
    NotFoundError: 404,
    ValidationError: 422,
    InvalidCredentialsError: 401,
    PermissionDeniedError: 403,
    UnknownInternalError: 500,
}


def register_exception_handlers(app: FastAPI) -> None:
    def make_handler(code: int) -> Callable:
        def handler(request: Request, exc: Exception) -> JSONResponse:
            message = f"{type(exc).__name__} on {request.method} {request.url.path} -> {code}"
            if code >= 500:
                logger.exception(message)
            else:
                logger.warning(message)
            return JSONResponse(status_code=code, content={"detail": str(exc)})

        return handler

    for exc_type, status_code in EXCEPTIONS_TO_CATCH_AND_THEIR_STATUS_CODES.items():
        app.add_exception_handler(exc_class_or_status_code=exc_type, handler=make_handler(status_code))
