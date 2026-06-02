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

_CDN = "https://cdn.jsdelivr.net"
DOCS_POLICY = "; ".join(
    [
        "default-src 'self'",
        f"script-src 'self' 'unsafe-inline' {_CDN}",
        f"style-src 'self' 'unsafe-inline' {_CDN} https://fonts.googleapis.com",
        f"img-src 'self' data: https://fastapi.tiangolo.com {_CDN}",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]
)

DOCS_PATHS = frozenset({"/redoc"})


def _policy_for(path: str) -> str:
    return DOCS_POLICY if path in DOCS_PATHS else DEFAULT_POLICY


async def csp_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    response.headers.setdefault(HEADER_NAME, _policy_for(request.url.path))  # noqa FKA100
    return response
