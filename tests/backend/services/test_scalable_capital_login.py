import subprocess  # nosec B404 -- only used to monkeypatch Popen and raise TimeoutExpired, never spawns
import tempfile
from datetime import timedelta
from pathlib import Path

import pytest

from source.backend.exceptions import InvalidTwoFactorError
from source.backend.helpers import utc_now
from source.backend.services.banking import scalable_capital_login as module

AUTHORIZATION_URL = "https://secure.scalable.capital/activate?user_code=DJQZ-TFNL"


@pytest.fixture(autouse=True)
def isolate_pending_logins(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(target=module, name="_pending_logins", value={})


class _FakeProcess:
    def __init__(self, lines: list[str], wait_returncode: int = 0, wait_hangs: bool = False):
        # Mirrors real Popen(text=True) stdout: an iterable of lines including the newline.
        self.stdout = iter(f"{line}\n" for line in lines)
        self.returncode: int | None = None
        self.killed = False
        self._wait_returncode = wait_returncode
        self._wait_hangs = wait_hangs

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    def poll(self) -> int | None:
        return self.returncode

    def wait(self, timeout: float | None = None) -> int:
        if self._wait_hangs:
            raise subprocess.TimeoutExpired(cmd="sc", timeout=timeout)
        self.returncode = self._wait_returncode
        return self.returncode


def _patch_subprocess(monkeypatch: pytest.MonkeyPatch, process: _FakeProcess) -> None:
    monkeypatch.setattr(target=subprocess, name="Popen", value=lambda *args, **kwargs: process)


def test_start_returns_authorization_url_and_registers_pending_login(monkeypatch: pytest.MonkeyPatch):
    process = _FakeProcess(
        lines=["Open this URL:", AUTHORIZATION_URL, "", "Verify the code DJQZ-TFNL in your browser."]
    )
    _patch_subprocess(monkeypatch=monkeypatch, process=process)

    token, authorization_url, device_code, expires_at = module.start(credential_id=1)

    assert authorization_url == AUTHORIZATION_URL
    # The URL already carries the code, so the follow-up line is not waited for.
    assert device_code is None
    assert expires_at > utc_now()
    assert token in module._pending_logins
    assert module._pending_logins[token].credential_id == 1


def test_start_reads_the_device_code_from_the_follow_up_line(monkeypatch: pytest.MonkeyPatch):
    # Without `verification_uri_complete` the auth server returns a bare URL (auth.rs:395-397).
    bare_url = "https://secure.scalable.capital/activate"
    process = _FakeProcess(lines=["Open this URL:", bare_url, "", "Verify the code DJQZ-TFNL in your browser."])
    _patch_subprocess(monkeypatch=monkeypatch, process=process)

    _token, authorization_url, device_code, _expires_at = module.start(credential_id=1)

    assert authorization_url == bare_url
    assert device_code == "DJQZ-TFNL"


def test_start_raises_when_process_ends_without_a_url(monkeypatch: pytest.MonkeyPatch):
    process = _FakeProcess(lines=["some unrelated output"])
    _patch_subprocess(monkeypatch=monkeypatch, process=process)

    with pytest.raises(InvalidTwoFactorError, match="without an authorization URL"):
        module.start(credential_id=1)

    assert module._pending_logins == {}
    assert process.killed


def test_complete_reads_back_config_dir_as_session_state(monkeypatch: pytest.MonkeyPatch):
    process = _FakeProcess(lines=["Open this URL:", AUTHORIZATION_URL], wait_returncode=0)
    _patch_subprocess(monkeypatch=monkeypatch, process=process)
    token, *_ = module.start(credential_id=1)
    config_dir = module._pending_logins[token].config_dir
    session_file = module.cli_config_dir(config_dir) / "session.json"
    session_file.write_text("token-data")

    session_state = module.complete(challenge_token=token, credential_id=1)

    restored_dir = Path(tempfile.mkdtemp())
    module.write_session_state(config_dir=restored_dir, session_state=session_state)

    assert (module.cli_config_dir(restored_dir) / "session.json").read_text() == "token-data"
    assert (module.cli_config_dir(restored_dir) / "config.toml").exists()  # written by start()
    assert module._pending_logins == {}
    assert not config_dir.exists()


def test_complete_rejects_unknown_token():
    with pytest.raises(InvalidTwoFactorError, match="Unknown or expired"):
        module.complete(challenge_token="no-such-token", credential_id=1)  # nosec B106


def test_complete_rejects_token_issued_for_other_credential(monkeypatch: pytest.MonkeyPatch):
    process = _FakeProcess(lines=["Open this URL:", AUTHORIZATION_URL])
    _patch_subprocess(monkeypatch=monkeypatch, process=process)
    token, *_ = module.start(credential_id=1)

    with pytest.raises(InvalidTwoFactorError):
        module.complete(challenge_token=token, credential_id=2)


def test_complete_raises_when_process_exited_nonzero(monkeypatch: pytest.MonkeyPatch):
    process = _FakeProcess(lines=["Open this URL:", AUTHORIZATION_URL], wait_returncode=1)
    _patch_subprocess(monkeypatch=monkeypatch, process=process)
    token, *_ = module.start(credential_id=1)

    with pytest.raises(InvalidTwoFactorError, match="login failed"):
        module.complete(challenge_token=token, credential_id=1)

    assert module._pending_logins == {}


def test_complete_times_out_when_browser_step_is_not_finished_yet(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        target=module, name="DURATION_TO_WAIT_FOR_PROCESS_ON_COMPLETE", value=timedelta(milliseconds=10)
    )
    process = _FakeProcess(lines=["Open this URL:", AUTHORIZATION_URL], wait_hangs=True)
    _patch_subprocess(monkeypatch=monkeypatch, process=process)
    token, *_ = module.start(credential_id=1)

    with pytest.raises(InvalidTwoFactorError, match="has not finished yet"):
        module.complete(challenge_token=token, credential_id=1)

    # The pending login must survive a "not finished yet" timeout so a later retry can still find it.
    assert token in module._pending_logins


def test_expired_challenge_is_cleaned_up_and_rejected(monkeypatch: pytest.MonkeyPatch):
    process = _FakeProcess(lines=["Open this URL:", AUTHORIZATION_URL])
    _patch_subprocess(monkeypatch=monkeypatch, process=process)
    token, *_ = module.start(credential_id=1)
    config_dir = module._pending_logins[token].config_dir
    module._pending_logins[token].expires_at = utc_now() - timedelta(seconds=1)

    with pytest.raises(InvalidTwoFactorError):
        module.complete(challenge_token=token, credential_id=1)

    assert module._pending_logins == {}
    assert not config_dir.exists()


def test_write_session_state_restores_original_file_permissions():
    source_dir = Path(tempfile.mkdtemp())
    key_file = module.cli_config_dir(source_dir) / "key.pem"
    key_file.parent.mkdir(parents=True)
    key_file.write_bytes(b"secret-key-material")
    key_file.chmod(0o600)

    session_state = module.read_session_state(source_dir)

    restored_dir = Path(tempfile.mkdtemp())
    module.write_session_state(config_dir=restored_dir, session_state=session_state)
    restored_key_file = module.cli_config_dir(restored_dir) / "key.pem"

    assert restored_key_file.read_bytes() == b"secret-key-material"
    assert oct(restored_key_file.stat().st_mode & 0o777) == "0o600"


def test_write_session_state_rejects_a_state_without_an_archive():
    with pytest.raises(ValueError, match="archive"):
        module.write_session_state(config_dir=Path(tempfile.mkdtemp()), session_state={"legacy": "600:ZmFrZQ=="})
