from enum import Enum
from typing import ClassVar

from sqlalchemy import inspect
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    __repr_exclude__: ClassVar[frozenset[str]] = frozenset()

    def __repr__(self) -> str:
        excluded = type(self).__repr_exclude__
        parts = []
        for column in inspect(type(self)).columns:
            if column.key in excluded:
                continue
            value = getattr(self, column.key)
            if isinstance(value, Enum):
                value = value.value
            parts.append(f"{column.key}={value}")
        return f"<{type(self).__name__}({', '.join(parts)})>"
