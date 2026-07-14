import tomllib
from unittest.mock import MagicMock

import pytest

from source.backend.helpers import get_project_version, get_root_path_of_repository
from source.backend.services import version_service
from tests.backend.conftest import assert_log_contains


def test_get_project_version_matches_pyproject():
    pyproject = get_root_path_of_repository() / "pyproject.toml"
    with pyproject.open("rb") as handle:
        expected = tomllib.load(handle)["tool"]["poetry"]["version"]

    assert get_project_version() == expected


@pytest.mark.parametrize(
    argnames="current, latest, expected",
    argvalues=[
        ("0.1.0", "0.1.9", True),
        ("0.1.9", "0.1.9", False),
        ("0.1.11", "0.1.9", False),
        ("0.1.9", "0.2.0", True),
        ("0.1.9", "garbage", False),
    ],
)
def test_is_newer(current: str, latest: str, expected: bool):
    assert version_service.is_newer(current=current, latest=latest) is expected


def test_github_latest_release_url_built_from_pyproject_repository():
    url = version_service.get_github_latest_release_url()

    assert url == "https://api.github.com/repos/felixschndr/quaestor/releases/latest"


def _github_response(tag: str, url: str) -> MagicMock:
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"tag_name": tag, "html_url": url}
    return response


def test_get_latest_release_parses_tag_and_url(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    get = MagicMock(return_value=_github_response(tag="v0.1.9", url="https://example/releases/0.1.9"))
    monkeypatch.setattr(target=version_service.requests, name="get", value=get)

    assert version_service.get_latest_release() == ("0.1.9", "https://example/releases/0.1.9")

    assert_log_contains(caplog, message="Latest release on GitHub is")


def test_get_latest_release_is_not_cached(monkeypatch: pytest.MonkeyPatch):
    get = MagicMock(return_value=_github_response(tag="0.1.9", url="https://example/0.1.9"))
    monkeypatch.setattr(target=version_service.requests, name="get", value=get)

    version_service.get_latest_release()
    version_service.get_latest_release()

    assert get.call_count == 2  # no cache


def test_get_latest_release_returns_none_when_response_has_no_tag(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"html_url": "https://example/releases/latest"}
    get = MagicMock(return_value=response)
    monkeypatch.setattr(target=version_service.requests, name="get", value=get)

    assert version_service.get_latest_release() is None

    assert_log_contains(caplog, message="had no tag_name")


def test_get_latest_release_returns_none_on_error(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    get = MagicMock(side_effect=version_service.requests.RequestException("boom"))
    monkeypatch.setattr(target=version_service.requests, name="get", value=get)

    assert version_service.get_latest_release() is None
    assert get.call_count == 1
    assert_log_contains(caplog, message="Could not fetch latest release from GitHub")
