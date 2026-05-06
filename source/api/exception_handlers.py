from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from source.exceptions import UserNotFoundError


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(UserNotFoundError)
    def _user_not_found(_request: Request, exc: UserNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})
