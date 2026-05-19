from typing import TYPE_CHECKING, Any

from source.backend.models.base import Base
from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from source.backend.models.credential import Credential


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)

    credential_id: Mapped[int] = mapped_column(ForeignKey("credentials.id"))
    name: Mapped[str] = mapped_column(String(120))
    balance: Mapped[float] = mapped_column(Float, default=0.0)

    credential: Mapped["Credential"] = relationship(back_populates="accounts")

    def __init__(self, **kw: Any) -> None:
        kw.setdefault("balance", 0.0)  # noqa: FKA100
        super().__init__(**kw)
