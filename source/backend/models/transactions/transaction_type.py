from enum import Enum


class TransactionType(str, Enum):
    # Plain money flow (e.g., FinTS)
    INCOMING = "INCOMING"
    OUTGOING = "OUTGOING"

    # Portfolio events (e.g., Trade Republic, DFS)
    BUY = "BUY"
    SELL = "SELL"
    DEPOSIT = "DEPOSIT"
    REMOVAL = "REMOVAL"
    DIVIDEND = "DIVIDEND"
    INTEREST = "INTEREST"
    INTEREST_CHARGE = "INTEREST_CHARGE"
    TAXES = "TAXES"
    TAX_REFUND = "TAX_REFUND"
    FEES = "FEES"
    FEES_REFUND = "FEES_REFUND"
    SPINOFF = "SPINOFF"
    SPLIT = "SPLIT"
    SWAP = "SWAP"
    TRANSFER_IN = "TRANSFER_IN"
    TRANSFER_OUT = "TRANSFER_OUT"

    ZERO = "ZERO"  # when amount == 0

    @classmethod
    def from_amount(cls: type["TransactionType"], amount: float) -> "TransactionType":
        if amount > 0:
            return cls.INCOMING
        if amount < 0:
            return cls.OUTGOING
        return cls.ZERO
