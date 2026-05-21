from typing import Awaitable, Callable

from fastapi import Request, Response

HEADER_NAME = "Content-Security-Policy"

# Tight default for a same-origin SPA: no inline scripts, no remote origins.
# `style-src 'unsafe-inline'` is kept because Tailwind / shadcn often inject inline styles
# at runtime; tighten this once the frontend is finalized.
DEFAULT_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]
)


async def csp_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    response.headers.setdefault(HEADER_NAME, DEFAULT_POLICY)  # noqa FKA100
    return response
