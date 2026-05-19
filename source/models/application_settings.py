from source.models.base import Base
from sqlalchemy.orm import Mapped, mapped_column


class ApplicationSetting(Base):
    __tablename__ = "application_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(unique=True)
    value: Mapped[str] = mapped_column()

    def __repr__(self) -> str:
        return f"<ApplicationSetting(id={self.id}, name={self.name}, value={self.value})>"
