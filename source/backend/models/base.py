from collections.abc import Iterable, Mapping
from enum import Enum
from typing import Any, ClassVar

from sqlalchemy.orm import DeclarativeBase, class_mapper


def _display_value(value: object) -> object:
    return value.value if isinstance(value, Enum) else value


def _format_repr(type_name: str, values: Mapping[str, object], excluded: frozenset[str]) -> str:
    parts = [f"{name}={_display_value(value)}" for name, value in values.items() if name not in excluded]
    return f"<{type_name}({', '.join(parts)})>"


def format_repr(obj: object, field_names: Iterable[str], excluded: frozenset[str]) -> str:
    values = {name: getattr(obj, name) for name in field_names}
    return _format_repr(type_name=type(obj).__name__, values=values, excluded=excluded)


class Base(DeclarativeBase):
    __repr_exclude__: ClassVar[frozenset[str]] = frozenset()

    def __repr__(self) -> str:
        column_names = (c.key for c in class_mapper(type(self)).columns)
        return format_repr(obj=self, field_names=column_names, excluded=type(self).__repr_exclude__)

    def describe_update(self, state_before_update: Mapping[str, Any]) -> str:
        entity_name = type(self).__name__.capitalize()
        excluded = type(self).__repr_exclude__
        state_after_update = snapshot_columns(self)

        changes = {
            key: (state_before_update.get(key), value)
            for key, value in state_after_update.items()
            if key not in excluded and state_before_update.get(key) != value
        }

        if not changes:
            return f"No changes to {entity_name} {self!r}"
        before_repr = _format_repr(type_name=entity_name, values=state_before_update, excluded=excluded)
        diff = ", ".join(f"{key}: {_display_value(old)} → {_display_value(new)}" for key, (old, new) in changes.items())
        return f"Updated {entity_name}: {diff} ({before_repr} → {self!r})"


def snapshot_columns(entity: Base) -> dict[str, Any]:
    return {column.key: getattr(entity, column.key) for column in class_mapper(type(entity)).columns}
