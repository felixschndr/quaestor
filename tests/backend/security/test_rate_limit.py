import pytest
from source.backend.security import rate_limit
from source.backend.security.rate_limit import InMemoryTokenBucketLimiter


def test_bucket_allows_up_to_capacity_then_blocks():
    bucket = InMemoryTokenBucketLimiter()
    for _ in range(5):
        allowed, _ = bucket.try_consume(key="k", capacity=5, refill_per_second=1.0)
        assert allowed
    allowed, retry_after = bucket.try_consume(key="k", capacity=5, refill_per_second=1.0)

    assert not allowed
    assert retry_after > 0


def test_bucket_refills_over_time(monkeypatch: pytest.MonkeyPatch):
    fake_time = [1000.0]
    monkeypatch.setattr(target=rate_limit.time, name="monotonic", value=lambda: fake_time[0])
    bucket = InMemoryTokenBucketLimiter()
    for _ in range(5):
        bucket.try_consume(key="k", capacity=5, refill_per_second=1.0)
    assert not bucket.try_consume(key="k", capacity=5, refill_per_second=1.0)[0]

    fake_time[0] += 2.0  # 2 tokens worth of refill

    assert bucket.try_consume(key="k", capacity=5, refill_per_second=1.0)[0]
    assert bucket.try_consume(key="k", capacity=5, refill_per_second=1.0)[0]
    assert not bucket.try_consume(key="k", capacity=5, refill_per_second=1.0)[0]


def test_bucket_keys_are_isolated():
    bucket = InMemoryTokenBucketLimiter()
    for _ in range(5):
        bucket.try_consume(key="a", capacity=5, refill_per_second=1.0)
    # "a" is empty but "b" should still have full capacity.
    assert not bucket.try_consume(key="a", capacity=5, refill_per_second=1.0)[0]
    assert bucket.try_consume(key="b", capacity=5, refill_per_second=1.0)[0]


def test_bucket_does_not_exceed_capacity_on_refill(monkeypatch: pytest.MonkeyPatch):
    fake_time = [0.0]
    monkeypatch.setattr(target=rate_limit.time, name="monotonic", value=lambda: fake_time[0])
    bucket = InMemoryTokenBucketLimiter()
    bucket.try_consume(key="k", capacity=3, refill_per_second=1.0)  # uses 1, 2 remain
    fake_time[0] += 1000.0  # very long wait

    # Even after a huge wait, only the configured capacity is available.
    for _ in range(3):
        assert bucket.try_consume(key="k", capacity=3, refill_per_second=1.0)[0]
    assert not bucket.try_consume(key="k", capacity=3, refill_per_second=1.0)[0]
