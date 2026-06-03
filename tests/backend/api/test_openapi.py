from fastapi import Depends, FastAPI
from source.backend.api import openapi
from source.backend.helpers import get_project_description
from source.backend.services import session_service


def _build_fresh(app: FastAPI) -> dict:
    app.openapi_schema = None
    return openapi.build_openapi(app)


def test_description_embeds_project_description_and_documents_both_auth_methods():
    assert get_project_description() in openapi.API_DESCRIPTION
    assert "## Authentication" in openapi.API_DESCRIPTION
    assert "Authorization: Bearer qk_" in openapi.API_DESCRIPTION
    assert "only be created in the web frontend" in openapi.API_DESCRIPTION


def test_build_openapi_declares_both_security_schemes():
    from source.backend import main

    schema = _build_fresh(main.app)

    schemes = schema["components"]["securitySchemes"]
    assert schemes["ApiKeyBearer"]["type"] == "http"
    assert schemes["ApiKeyBearer"]["scheme"] == "bearer"
    assert schemes["SessionCookie"]["type"] == "apiKey"
    assert schemes["SessionCookie"]["name"] == session_service.COOKIE_NAME


def test_build_openapi_caches_the_schema():
    app = FastAPI()
    sentinel = {"already": "built"}
    app.openapi_schema = sentinel

    assert openapi.build_openapi(app) is sentinel


def test_security_reflects_each_endpoints_auth_dependency():
    from source.backend import main

    paths = _build_fresh(main.app)["paths"]

    # Data endpoints accept a session cookie or an API key.
    assert paths["/api/auth/me"]["get"]["security"] == [{"SessionCookie": []}, {"ApiKeyBearer": []}]
    # Self-management endpoints accept only a session cookie — an API key must not be advertised here.
    assert paths["/api/api_keys"]["post"]["security"] == [{"SessionCookie": []}]
    assert paths["/api/users/{user_id}/2fa/setup"]["post"]["security"] == [{"SessionCookie": []}]
    # Public endpoints require neither.
    assert paths["/api/auth/login"]["post"]["security"] == []


def test_every_documented_operation_has_a_security_requirement():
    from source.backend import main

    paths = _build_fresh(main.app)["paths"]

    operations_without_security = [
        f"{method.upper()} {path}"
        for path, item in paths.items()
        for method, operation in item.items()
        if "security" not in operation
    ]
    assert operations_without_security == []


def test_security_for_route_maps_each_dependency_to_its_schemes():
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

    paths = _build_fresh(app)["paths"]

    assert paths["/cookie-or-key"]["get"]["security"] == [{"SessionCookie": []}, {"ApiKeyBearer": []}]
    assert paths["/cookie-only"]["get"]["security"] == [{"SessionCookie": []}]
    assert paths["/public"]["get"]["security"] == []


def test_configure_openapi_installs_the_builder_on_the_app():
    app = FastAPI()

    openapi.configure_openapi(app)
    schema = app.openapi()

    assert "ApiKeyBearer" in schema["components"]["securitySchemes"]
    # Second call returns the cached schema rather than rebuilding it.
    assert app.openapi() is schema
