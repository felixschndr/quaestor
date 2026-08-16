from enum import Enum


class FlowLinkSource(str, Enum):
    DETECTED = "DETECTED"
    MANUAL = "MANUAL"
