import secrets
from typing import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from source.backend.constants import API_PREFIX
from source.backend.logging_utils import get_logger
from source.backend.services import api_key_service
from source.backend.services.session_service import cookie_is_secure

logger = get_logger(__name__)

COOKIE_NAME = "csrf_token"
HEADER_NAME = "X-CSRF-Token"
MUTATING_METHODS: frozenset[str] = frozenset({"POST", "PATCH", "PUT", "DELETE"})


def _requires_validation(request: Request) -> bool:
    if request.method not in MUTATING_METHODS or not request.url.path.startswith(API_PREFIX):
        return False
    if api_key_service.request_carries_api_key(request):
        return False
    return True


async def csrf_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    if _requires_validation(request):
        cookie_token = request.cookies.get(COOKIE_NAME)
        header_token = request.headers.get(HEADER_NAME)
        if (
            not cookie_token
            or not header_token
            or not secrets.compare_digest(cookie_token, header_token)  # noqa FKA100
        ):
            logger.warning(f"CSRF validation failed for [{request.method}] [{request.url.path}]")
            return JSONResponse(status_code=403, content={"detail": "Invalid CSRF token"})

    response = await call_next(request)

    if COOKIE_NAME not in request.cookies and not request.url.path.startswith("/static"):
        response.set_cookie(
            key=COOKIE_NAME,
            value=secrets.token_urlsafe(32),
            httponly=False,  # readable by the SPA so it can echo it back in the X-CSRF-Token header
            samesite="strict",
            secure=cookie_is_secure(),
            path="/",
        )
    return response
