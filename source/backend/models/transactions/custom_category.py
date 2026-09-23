import secrets
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from source.backend.models.base import Base
from source.backend.models.transactions.transaction_category import CategoryGroup

if TYPE_CHECKING:
    from source.backend.models.auth.user import User

CUSTOM_CATEGORY_KEY_PREFIX = "CUSTOM_"
MAX_CUSTOM_CATEGORY_NAME_LENGTH = 50


def new_custom_category_key() -> str:
    return f"{CUSTOM_CATEGORY_KEY_PREFIX}{secrets.token_hex(4).upper()}"


class CustomCategory(Base):
    __tablename__ = "custom_categories"
    __table_args__ = (
        UniqueConstraint("user_id", "group", "name", name="uq_custom_categories_user_group_name"),  # noqa: FKA100
    )

    key: Mapped[str] = mapped_column(String, primary_key=True, default=new_custom_category_key)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    group: Mapped[CategoryGroup] = mapped_column(SQLEnum(CategoryGroup))
    name: Mapped[str] = mapped_column(String(MAX_CUSTOM_CATEGORY_NAME_LENGTH))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped["User"] = relationship(back_populates="custom_categories")
