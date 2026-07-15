import datetime
import socket
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock

import httpx  # noqa ASYNC127
import pytest
import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from sqlalchemy.orm import sessionmaker

from source.backend import main, server
from source.backend.db import get_session
from tests.backend.conftest import VALID_PASSWORD


def test_run_invokes_uvicorn_with_resolved_options(monkeypatch: pytest.MonkeyPatch):
    uvicorn_run = MagicMock()
    monkeypatch.setattr(target=server.uvicorn, name="run", value=uvicorn_run)
    fake_options = {"host": "0.0.0.0", "port": 1234, "proxy_headers": True, "forwarded_allow_ips": "*"}  # nosec B104
    monkeypatch.setattr(target=server, name="uvicorn_options", value=lambda: fake_options)

    server.run()

    uvicorn_run.assert_called_once_with(main.app, **fake_options)


def test_uvicorn_options_defaults_to_http(monkeypatch: pytest.MonkeyPatch):
    for variable in ("HOST", "PORT", "SSL_CERTFILE", "SSL_KEYFILE", "FORWARDED_ALLOW_IPS"):
        monkeypatch.delenv(name=variable, raising=False)

    options = server.uvicorn_options()

    assert options == {
        "host": server.DEFAULT_HOST,
        "port": server.DEFAULT_PORT,
        "proxy_headers": True,
        "forwarded_allow_ips": server.DEFAULT_FORWARDED_ALLOW_IPS,
        "ws_ping_interval": None,
        "ws_ping_timeout": None,
        "timeout_graceful_shutdown": int(server.GRACEFUL_SHUTDOWN_TIMEOUT.total_seconds()),
    }


def test_uvicorn_options_forwarded_allow_ips_is_overridable(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name="FORWARDED_ALLOW_IPS", value="10.0.0.1,10.0.0.2")

    options = server.uvicorn_options()

    assert options["forwarded_allow_ips"] == "10.0.0.1,10.0.0.2"
    assert options["proxy_headers"] is True


def test_uvicorn_options_includes_ssl_when_both_files_set(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(name="SSL_CERTFILE", value="certfile.pem")
    monkeypatch.setenv(name="SSL_KEYFILE", value="keyfile.pem")

    options = server.uvicorn_options()

    assert options["ssl_certfile"] == "certfile.pem"
    assert options["ssl_keyfile"] == "keyfile.pem"


@pytest.mark.parametrize(
    argnames="present,missing", argvalues=[("SSL_CERTFILE", "SSL_KEYFILE"), ("SSL_KEYFILE", "SSL_CERTFILE")]
)
def test_uvicorn_options_rejects_partial_ssl_configuration(monkeypatch: pytest.MonkeyPatch, present: str, missing: str):
    monkeypatch.setenv(name=present, value="ssl.pem")
    monkeypatch.delenv(missing, raising=False)

    with pytest.raises(RuntimeError):
        server.uvicorn_options()


def _get_free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def _write_self_signed_certificate(directory: Path) -> tuple[str, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(oid=NameOID.COMMON_NAME, value="localhost")])
    now = datetime.datetime.now(datetime.timezone.utc)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=1))
        .sign(private_key=key, algorithm=hashes.SHA256())
    )
    certfile = directory / "cert.pem"
    keyfile = directory / "key.pem"
    certfile.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    keyfile.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    return str(certfile), str(keyfile)


@pytest.fixture
def isolated_app(session_factory: sessionmaker, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    def override_get_session() -> Iterator:
        with session_factory() as session:
            yield session

    monkeypatch.setattr(target=main, name="SessionLocal", value=session_factory)
    main.app.dependency_overrides[get_session] = override_get_session
    yield
    main.app.dependency_overrides.clear()


@contextmanager
def running_server():
    config = uvicorn.Config(main.app, **server.uvicorn_options(), log_level="warning")
    instance = uvicorn.Server(config)
    thread = threading.Thread(target=instance.run, daemon=True)
    thread.start()
    while not instance.started:
        time.sleep(0.05)
    try:
        yield
    finally:
        instance.should_exit = True
        thread.join(timeout=5)


def test_server_accepts_plain_http_connection(isolated_app: None, monkeypatch: pytest.MonkeyPatch):
    port = _get_free_port()
    monkeypatch.setenv(name="PORT", value=str(port))
    for variable in ("SSL_CERTFILE", "SSL_KEYFILE"):
        monkeypatch.delenv(name=variable, raising=False)

    with running_server():
        response = httpx.get(f"http://127.0.0.1:{port}/openapi.json")

    assert response.status_code == 200


def test_server_honors_x_forwarded_for_when_proxy_is_trusted(isolated_app: None, monkeypatch: pytest.MonkeyPatch):
    port = _get_free_port()
    monkeypatch.setenv(name="PORT", value=str(port))
    for variable in ("SSL_CERTFILE", "SSL_KEYFILE"):
        monkeypatch.delenv(name=variable, raising=False)

    with running_server():
        # First prime the csrf_token cookie with an honest GET.
        with httpx.Client(base_url=f"http://127.0.0.1:{port}") as client:
            client.get("/api/settings")
            csrf_token = client.cookies.get("csrf_token")
            client.headers["X-CSRF-Token"] = csrf_token
            # Now pretend to be a reverse proxy forwarding a real client at 203.0.113.7.
            client.headers["X-Forwarded-For"] = "203.0.113.7"
            registered = client.post(
                "/api/auth/register",
                json={
                    "user_name": "proxied",
                    "display_name": "Proxied",
                    "password": VALID_PASSWORD,
                },
            )
            user_id = registered.json()["id"]
            sessions = client.get(f"/api/users/{user_id}/sessions").json()

    # The session row should reflect the forwarded IP, not the proxy's 127.0.0.1.
    assert any(s["ip"] == "203.0.113.7" for s in sessions), sessions


def test_server_accepts_https_connection(isolated_app: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    port = _get_free_port()
    certfile, keyfile = _write_self_signed_certificate(tmp_path)
    monkeypatch.setenv(name="PORT", value=str(port))
    monkeypatch.setenv(name="SSL_CERTFILE", value=certfile)
    monkeypatch.setenv(name="SSL_KEYFILE", value=keyfile)

    with running_server():
        response = httpx.get(f"https://127.0.0.1:{port}/openapi.json", verify=False)  # nosec B501

    assert response.status_code == 200
