from enum import Enum


class ContractSource(str, Enum):
    DETECTED = "DETECTED"
    MANUAL = "MANUAL"
