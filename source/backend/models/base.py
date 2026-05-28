from collections.abc import Iterable
from enum import Enum
from typing import ClassVar

from sqlalchemy import inspect
from sqlalchemy.orm import DeclarativeBase


def format_repr(obj: object, field_names: Iterable[str], excluded: frozenset[str]) -> str:
    parts = []
    for name in field_names:
        if name in excluded:
            continue
        value = getattr(obj, name)
        if isinstance(value, Enum):
            value = value.value
        parts.append(f"{name}={value}")
    return f"<{type(obj).__name__}({', '.join(parts)})>"


class Base(DeclarativeBase):
    __repr_exclude__: ClassVar[frozenset[str]] = frozenset()

    def __repr__(self) -> str:
        column_names = (c.key for c in inspect(type(self)).columns)
        return format_repr(obj=self, field_names=column_names, excluded=type(self).__repr_exclude__)
