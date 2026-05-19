from fastapi import APIRouter
from source.backend.api.create_router import create_router


def test_router_prefix_and_tags_are_derived_from_caller_filename() -> None:
    router = create_router()

    assert isinstance(router, APIRouter)
    assert router.prefix == "/test_create_router"
    assert router.tags == ["Test Create Router"]
