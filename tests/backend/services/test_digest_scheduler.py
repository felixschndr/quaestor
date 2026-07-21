import pytest

from source.backend.services.notifications import digest_scheduler
from tests.backend.conftest import assert_log_contains

run_periodic_digest = digest_scheduler.run_periodic_digest


class StopTheLoop(Exception):
    pass


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_crashing_digest_run_is_logged(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    def raise_error() -> None:
        raise RuntimeError("digest failed")

    async def stop_the_loop(delay: float) -> None:  # noqa: ASYNC124
        raise StopTheLoop

    monkeypatch.setattr(target=digest_scheduler, name="_evaluate_digests", value=raise_error)
    monkeypatch.setattr(target=digest_scheduler.asyncio, name="sleep", value=stop_the_loop)

    with pytest.raises(StopTheLoop):
        await run_periodic_digest()

    assert_log_contains(caplog, message="Digest run crashed")
