from source.models.base import Base
from sqlalchemy.orm import Mapped, mapped_column


class ApplicationSecret(Base):
    __tablename__ = "application_secrets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
    value: Mapped[str] = mapped_column()
