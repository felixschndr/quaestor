from collections import defaultdict
from datetime import date
from typing import TYPE_CHECKING, List

from source.backend.bank_handlers.base import BalanceObservation, FetchedAccount
from source.backend.logging_utils import get_logger
from source.backend.models.account_balance_snapshot import (
    AccountBalanceSnapshot,
    BalanceSnapshotSource,
)
from source.backend.models.account_group import (  # noqa: F401 — registers FK target table
    AccountGroup,
)
from source.backend.models.base import Base
from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.orm import (
    Mapped,
    attribute_keyed_dict,
    mapped_column,
    object_session,
    relationship,
)

if TYPE_CHECKING:
    from source.backend.models.credential import Credential
    from source.backend.models.transaction import Transaction

logger = get_logger(__name__)

# Below this a mismatch between a computed and a bank-reported balance is just
# floating-point noise and not worth flagging.
BALANCE_DRIFT_TOLERANCE = 0.01


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)

    credential_id: Mapped[int] = mapped_column(ForeignKey("credentials.id"))
    name: Mapped[str] = mapped_column(String(120))
    display_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    balance: Mapped[float] = mapped_column(Float, default=0.0)
    balance_factor: Mapped[int] = mapped_column(default=100)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    tracks_balance_history: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")

    # User-defined grouping for the overview. NULL = "ungrouped" (rendered in a
    # default bucket). `position` orders accounts within their group OR within
    # the ungrouped bucket.
    group_id: Mapped[int | None] = mapped_column(ForeignKey("account_groups.id", ondelete="SET NULL"), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    credential: Mapped["Credential"] = relationship(back_populates="accounts")
    group: Mapped["AccountGroup | None"] = relationship(back_populates="accounts")
    transactions: Mapped[List["Transaction"]] = relationship(back_populates="account", cascade="all, delete-orphan")
    balance_at_date: Mapped[dict[date, "AccountBalanceSnapshot"]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
        collection_class=attribute_keyed_dict("date"),
    )

    @classmethod
    def from_fetched(cls: type["Account"], fetched_account: FetchedAccount) -> "Account":
        return cls(name=fetched_account.name, tracks_balance_history=fetched_account.tracks_balance_history)

    def record_balance_observations(self, observations: list[BalanceObservation]) -> None:
        # Persist bank-reported balances as ground-truth anchors. They are kept across recomputes
        # (unlike COMPUTED snapshots) and re-ground the backward walk in update_balance_at_date.
        if not self.tracks_balance_history:
            return

        today = date.today()
        for observation in observations:
            if observation.date > today:
                continue
            snapshot = self.balance_at_date.get(observation.date)
            if snapshot is None:
                self.balance_at_date[observation.date] = AccountBalanceSnapshot(
                    date=observation.date,
                    balance=observation.amount,
                    source=BalanceSnapshotSource.BANK_REPORTED,
                )
            else:
                snapshot.balance = observation.amount
                snapshot.source = BalanceSnapshotSource.BANK_REPORTED

    def update_balance_at_date(self) -> None:
        if not self.tracks_balance_history:
            return

        today = date.today()
        daily_totals: dict[date, float] = defaultdict(float)
        for transaction in self.transactions:
            if transaction.date > today or transaction.pending:  # Future-dated transactions haven't moved money yet
                continue
            daily_totals[transaction.date] += transaction.amount

        anchors = {
            day: snapshot.balance
            for day, snapshot in self.balance_at_date.items()
            if snapshot.source == BalanceSnapshotSource.BANK_REPORTED and day <= today
        }

        running_balance = self.balance
        for day in sorted(set(daily_totals) | set(anchors), reverse=True):
            if day in anchors:
                # Trust the bank: reset the walk to its reported balance
                self._log_balance_drift(day=day, computed=running_balance, reported=anchors[day])
                running_balance = anchors[day]
            elif day not in self.balance_at_date:
                self.balance_at_date[day] = AccountBalanceSnapshot(date=day, balance=running_balance)
            running_balance = round(number=running_balance - daily_totals[day], ndigits=2)

    def _log_balance_drift(self, day: date, computed: float, reported: float) -> None:
        if abs(computed - reported) <= BALANCE_DRIFT_TOLERANCE:
            return
        logger.warning(
            f"Balance drift on {self} at {day}: computed {computed:.2f} vs "
            f"bank-reported {reported:.2f} (diff {computed - reported:+.2f})"
        )

    def recompute_balances_at_date(self) -> None:
        # Drop the derived snapshots and rebuild them.
        # Bank-reported anchors are ground truth and survive recomputing
        keep_anchors = self.tracks_balance_history
        stale_days = [
            day
            for day, snapshot in self.balance_at_date.items()
            if not (keep_anchors and snapshot.source == BalanceSnapshotSource.BANK_REPORTED)
        ]
        for day in stale_days:
            del self.balance_at_date[day]
        session = object_session(self)
        if session is not None:
            session.flush()
        self.update_balance_at_date()
