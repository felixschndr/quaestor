import threading
import time
from typing import Awaitable, Callable, Protocol

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from source.backend.constants import API_PREFIX
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

STRICT_PATHS: frozenset[str] = frozenset(
    {
        f"{API_PREFIX}/auth/login",
        f"{API_PREFIX}/auth/register",
        f"{API_PREFIX}/auth/2fa",
    }
)

STRICT_CAPACITY = 5  # burst budget
STRICT_REFILL_PER_SECOND = 5 / 60.0  # 5 per minute sustained

GLOBAL_CAPACITY = 120
GLOBAL_REFILL_PER_SECOND = 120 / 60.0


class RateLimiter(Protocol):
    def try_consume(self, key: str, capacity: int, refill_per_second: float) -> tuple[bool, float]:
        """Return (allowed, retry_after_seconds). retry_after is 0 when allowed."""


class InMemoryTokenBucketLimiter:
    def __init__(self) -> None:
        # key -> (tokens, last_check_monotonic)
        self._buckets: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def try_consume(self, key: str, capacity: int, refill_per_second: float) -> tuple[bool, float]:
        with self._lock:
            now = time.monotonic()
            tokens, last = self._buckets.get(key, (float(capacity), now))  # noqa FKA100
            tokens = min(float(capacity), tokens + (now - last) * refill_per_second)
            if tokens < 1.0:
                self._buckets[key] = (tokens, now)
                retry_after = (1.0 - tokens) / refill_per_second if refill_per_second > 0 else float("inf")
                return False, retry_after
            self._buckets[key] = (tokens - 1.0, now)
            return True, 0.0


# Module-level instance so tests can monkeypatch / reset it.
limiter: RateLimiter = InMemoryTokenBucketLimiter()


def _client_key(request: Request) -> str:
    client = request.client
    if client is None:
        return "unknown"
    return client.host


def _bucket_for(request: Request) -> tuple[str, int, float]:
    if request.url.path in STRICT_PATHS:
        return "auth", STRICT_CAPACITY, STRICT_REFILL_PER_SECOND
    return "global", GLOBAL_CAPACITY, GLOBAL_REFILL_PER_SECOND


async def rate_limit_middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    if not request.url.path.startswith(API_PREFIX):
        return await call_next(request)

    bucket_class, capacity, refill = _bucket_for(request)
    key = f"{bucket_class}:{_client_key(request)}"
    allowed, retry_after = limiter.try_consume(key=key, capacity=capacity, refill_per_second=refill)
    if not allowed:
        logger.warning(f"Rate limit exceeded for {request.method} {request.url.path} (key={key})")
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(max(1, int(retry_after) + 1))},
            content={"detail": "Too many requests"},
        )
    return await call_next(request)
