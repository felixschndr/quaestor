from fastapi import Depends, FastAPI

from source.backend import main
from source.backend.api.core import openapi
from source.backend.helpers import get_project_description
from source.backend.services.auth import session_service

PUBLIC_OPERATIONS = {
    "GET /api/auth/password_requirements",
    "GET /api/i18n/languages",
    "GET /api/push/public-key",
    "GET /api/settings",
    "GET /api/version",
    "POST /api/auth/2fa",
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "POST /api/auth/register",
}


def test_description_embeds_project_description_and_documents_both_auth_methods():
    assert get_project_description() in openapi.API_DESCRIPTION
    assert "## Authentication" in openapi.API_DESCRIPTION
    assert "Authorization: Bearer qk_" in openapi.API_DESCRIPTION
    assert "only be created in the web frontend" in openapi.API_DESCRIPTION


def test_both_security_schemes_are_declared():
    schemes = main.app.openapi()["components"]["securitySchemes"]

    assert schemes["API key"]["type"] == "http"
    assert schemes["API key"]["scheme"] == "bearer"
    assert schemes["Session cookie"]["type"] == "apiKey"
    assert schemes["Session cookie"]["name"] == session_service.COOKIE_NAME


def test_security_reflects_each_endpoints_auth_dependency():
    paths = main.app.openapi()["paths"]

    # Data endpoints accept a session cookie or an API key.
    assert paths["/api/auth/me"]["get"]["security"] == [{"Session cookie": []}, {"API key": []}]
    # Self-management endpoints accept only a session cookie
    assert paths["/api/api_keys"]["post"]["security"] == [{"Session cookie": []}]
    # Public endpoints advertise no requirement at all.
    assert "security" not in paths["/api/auth/login"]["post"]


def test_only_the_known_public_operations_are_unauthenticated():
    paths = main.app.openapi()["paths"]

    unauthenticated = {
        f"{method.upper()} {path}"
        for path, item in paths.items()
        for method, operation in item.items()
        if "security" not in operation
    }
    assert unauthenticated == PUBLIC_OPERATIONS


def test_each_auth_dependency_maps_to_its_schemes():
    app = FastAPI()

    @app.get("/cookie-or-key")
    def _both(user: object = Depends(session_service.get_current_user_from_request)) -> object:
        return user

    @app.get("/cookie-only")
    def _cookie(user: object = Depends(session_service.get_current_user_from_session)) -> object:
        return user

    @app.get("/public")
    def _public() -> None:
        return None

    paths = app.openapi()["paths"]

    assert paths["/cookie-or-key"]["get"]["security"] == [{"Session cookie": []}, {"API key": []}]
    assert paths["/cookie-only"]["get"]["security"] == [{"Session cookie": []}]
    assert "security" not in paths["/public"]["get"]
