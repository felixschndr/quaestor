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
    from source.backend.models.recurring_transaction import RecurringTransaction
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

    # User-defined grouping for the overview. NULL = "ungrouped" (rendered in a
    # default bucket). `position` orders accounts within their group OR within
    # the ungrouped bucket.
    group_id: Mapped[int | None] = mapped_column(ForeignKey("account_groups.id", ondelete="SET NULL"), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    credential: Mapped["Credential"] = relationship(back_populates="accounts")
    group: Mapped["AccountGroup | None"] = relationship(back_populates="accounts")
    transactions: Mapped[List["Transaction"]] = relationship(back_populates="account", cascade="all, delete-orphan")
    recurring_transactions: Mapped[List["RecurringTransaction"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
    balance_at_date: Mapped[dict[date, "AccountBalanceSnapshot"]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
        collection_class=attribute_keyed_dict("date"),
    )

    @classmethod
    def from_fetched(cls: type["Account"], fetched_account: FetchedAccount) -> "Account":
        return cls(name=fetched_account.name)

    @property
    def is_market_valued(self) -> bool:
        # Market-valued accounts (depots/funds) carry MARKET_VALUED snapshots and are priced by the
        # handler instead of the transaction-driven backward walk.
        return any(snapshot.source == BalanceSnapshotSource.MARKET_VALUED for snapshot in self.balance_at_date.values())

    def record_market_value_history(self, observations: list[BalanceObservation]) -> None:
        today = date.today()
        for day in [
            day
            for day, snapshot in self.balance_at_date.items()
            if snapshot.source == BalanceSnapshotSource.MARKET_VALUED
        ]:
            del self.balance_at_date[day]
        session = object_session(self)
        if session is not None:
            session.flush()
        for observation in observations:
            if observation.date > today:
                continue
            self.balance_at_date[observation.date] = AccountBalanceSnapshot(
                date=observation.date,
                balance=observation.amount,
                source=BalanceSnapshotSource.MARKET_VALUED,
            )
        logger.debug(f"Recorded {len(observations)} market-value snapshot(s) for {self}")

    def record_balance_observations(self, observations: list[BalanceObservation]) -> None:
        # Persist bank-reported balances as ground-truth anchors. They are kept across recomputes
        # (unlike COMPUTED snapshots) and re-ground the backward walk in update_balance_at_date.
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

        oldest_anchor = min(anchors) if anchors else None

        running_balance = self.balance
        for day in sorted(set(daily_totals) | set(anchors), reverse=True):
            if day in anchors:
                # Bank-reported balances are captured before that day's transactions post, so they
                # represent the start-of-day balance (== end of the previous day). Compare like for
                # like, then reset the walk to the anchor WITHOUT re-subtracting the day's own
                # transactions -- they are already excluded from the reported balance. Subtracting
                # them again would double-count every anchor-day booking across the whole earlier
                # history.
                computed_before = round(number=running_balance - daily_totals[day], ndigits=2)
                self._log_balance_drift(
                    day=day, computed=computed_before, reported=anchors[day], at_fetch_horizon=day == oldest_anchor
                )
                running_balance = anchors[day]
                continue
            if day not in self.balance_at_date:
                self.balance_at_date[day] = AccountBalanceSnapshot(date=day, balance=running_balance)
            running_balance = round(number=running_balance - daily_totals[day], ndigits=2)

    def _log_balance_drift(self, day: date, computed: float, reported: float, at_fetch_horizon: bool = False) -> None:
        if abs(computed - reported) <= BALANCE_DRIFT_TOLERANCE:
            return
        message = (
            f"Balance drift on {self} at {day}: computed {computed:.2f} vs "
            f"bank-reported {reported:.2f} (diff {computed - reported:+.2f})"
        )
        # Drift at the oldest anchor is unavoidable because we can't fetch ALL transactions
        if at_fetch_horizon:
            logger.debug(f"{message} (at fetch horizon, expected)")
        else:
            logger.warning(message)

    def recompute_balances_at_date(self) -> None:
        if self.is_market_valued:
            return

        # Drop the derived snapshots and rebuild them.
        # Bank-reported anchors are ground truth and survive recomputing
        stale_days = [
            day
            for day, snapshot in self.balance_at_date.items()
            if snapshot.source != BalanceSnapshotSource.BANK_REPORTED
        ]
        for day in stale_days:
            del self.balance_at_date[day]
        session = object_session(self)
        if session is not None:
            session.flush()
        self.update_balance_at_date()
