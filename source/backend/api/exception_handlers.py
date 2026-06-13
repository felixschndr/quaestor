from typing import Any, Callable

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from source.backend.exceptions import (
    ConflictError,
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
    ConflictError: 409,
    UnknownInternalError: 500,
}


def _loggable_validation_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    # Only log loc, message and type to not leak sensitive information (like input)
    return [{"loc": error.get("loc"), "msg": error.get("msg"), "type": error.get("type")} for error in exc.errors()]


def register_exception_handlers(app: FastAPI) -> None:
    def make_handler(code: int) -> Callable:
        def handler(request: Request, exc: Exception) -> JSONResponse:
            message = f"{type(exc).__name__} on [{request.method}] [{request.url.path}] -> {code}: {exc}"
            if code >= 500:
                logger.exception(message, exc_info=exc)
            else:
                logger.warning(message)
            return JSONResponse(status_code=code, content={"detail": str(exc)})

        return handler

    def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Catch and log FastAPI's RequestValidationError
        message = f"RequestValidationError on [{request.method}] [{request.url.path}] -> 422: {_loggable_validation_errors(exc)}"
        logger.error(message)
        return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})

    for exc_type, status_code in EXCEPTIONS_TO_CATCH_AND_THEIR_STATUS_CODES.items():
        app.add_exception_handler(exc_class_or_status_code=exc_type, handler=make_handler(status_code))

    app.add_exception_handler(exc_class_or_status_code=RequestValidationError, handler=validation_handler)
