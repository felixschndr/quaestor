from typing import Any

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute
from source.backend.helpers import get_project_description
from source.backend.services import session_service

API_DESCRIPTION = f"""
{get_project_description()}

## Authentication

Every `/api` endpoint requires authentication. There are two ways to authenticate, and they grant access
to the same account.

### Session cookie

The web frontend signs in via `POST /api/auth/login` and receives an `HttpOnly` `session` cookie that the
browser then sends automatically on every request. This is what the UI uses; you normally never deal with
it directly.

### API key

For programmatic access, send a personal API key as a Bearer token:

```
Authorization: Bearer qk_your_api_key
```

API keys can **only be created in the web frontend**, under *Settings → API keys* (there is deliberately
no endpoint to create one). A key is only shown once at creation time. You can revoke a key from the same screen.

An API key can drive the same data endpoints as the frontend (accounts, transactions, bank connections,
syncing). For safety it **cannot** be used for account self-management (e.g. changing your password or managing
two-factor authentication)
"""

_SECURITY_SCHEMES = {
    "SessionCookie": {
        "type": "apiKey",
        "in": "cookie",
        "name": session_service.COOKIE_NAME,
        "description": "Session cookie issued by `POST /api/auth/login`; used by the web frontend.",
    },
    "ApiKeyBearer": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "qk_...",
        "description": (
            "Personal API key, created in the web frontend under Settings → API keys and sent as "
            "`Authorization: Bearer qk_...`."
        ),
    },
}

_SECURITY_COOKIE_OR_API_KEY = [{"SessionCookie": []}, {"ApiKeyBearer": []}]
_SECURITY_COOKIE_ONLY = [{"SessionCookie": []}]
_SECURITY_PUBLIC: list[dict[str, list[str]]] = []


def _dependency_calls(dependant: Dependant) -> set[object]:
    calls: set[object] = set()
    for dependency in dependant.dependencies:
        if dependency.call is not None:
            calls.add(dependency.call)
        calls |= _dependency_calls(dependency)
    return calls


def _security_for_route(route: APIRoute) -> list[dict[str, list[str]]]:
    calls = _dependency_calls(route.dependant)
    if session_service.get_current_user_from_request in calls:
        return _SECURITY_COOKIE_OR_API_KEY
    if session_service.get_current_user_from_session in calls:
        return _SECURITY_COOKIE_ONLY
    return _SECURITY_PUBLIC


def _apply_security_requirements(app: FastAPI, schema: dict[str, Any]) -> None:
    paths = schema.get("paths") or {}
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        operations = paths.get(route.path) or {}
        requirement = _security_for_route(route)
        for method in route.methods:
            operation = operations.get(method.lower())
            if operation is not None:
                operation["security"] = requirement


def build_openapi(app: FastAPI) -> dict[str, Any]:
    if app.openapi_schema:
        return app.openapi_schema  # When opening the docs a second time
    schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)
    components = schema.get("components") or {}
    components["securitySchemes"] = _SECURITY_SCHEMES
    schema["components"] = components
    _apply_security_requirements(app=app, schema=schema)
    app.openapi_schema = schema
    return schema


def configure_openapi(app: FastAPI) -> None:
    def openapi() -> dict[str, Any]:
        return build_openapi(app)

    app.openapi = openapi
