from enum import Enum


class CategorySource(str, Enum):
    # Derived from the matchers; re-derived whenever they change
    AUTO = "AUTO"
    MANUAL = "MANUAL"
    CONTRACT = "CONTRACT"
    # A bank-flagged refund or a detected reversal; the matchers cannot reproduce it, so it is never re-derived
    SYSTEM = "SYSTEM"
