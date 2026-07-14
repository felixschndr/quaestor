from enum import Enum


class ContractAssignment(str, Enum):
    AUTO = "AUTO"  # Linked by the detector; re-evaluated on every run
    MANUAL = "MANUAL"  # Pinned by the user; the detector never touches it
    EXCLUDED = "EXCLUDED"  # User removed it; remembered so the detector won't re-add it
