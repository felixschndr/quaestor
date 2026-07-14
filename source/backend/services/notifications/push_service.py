import base64
import json
from dataclasses import dataclass
from enum import Enum

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush

from source.backend.logging_utils import get_logger
from source.backend.paths import DATA_DIR

logger = get_logger(__name__)

VAPID_PRIVATE_KEY_PATH = DATA_DIR / "vapid_private.pem"
# The push services (FCM/Mozilla/Apple) want a contact in the JWT so they can reach
# the app operator about misbehaving pushes. Apple in particular validates this and
# rejects bogus values with "BadJwtToken", so the default uses a real, resolvable TLD.
DEFAULT_VAPID_SUBJECT = "mailto:quaestor@example.com"

_GONE_STATUS_CODES = frozenset({404, 410})

_vapid: Vapid02 | None = None


class PushOutcome(str, Enum):
    DELIVERED = "delivered"
    EXPIRED = "expired"
    FAILED = "failed"


@dataclass(frozen=True)
class PushResult:
    outcome: PushOutcome
    detail: str | None = None


def _load_or_create_vapid() -> Vapid02:
    global _vapid
    if _vapid is not None:
        return _vapid

    if VAPID_PRIVATE_KEY_PATH.exists():
        vapid = Vapid02.from_file(str(VAPID_PRIVATE_KEY_PATH))
        logger.debug(f"Loaded VAPID key pair from {VAPID_PRIVATE_KEY_PATH}")
    else:
        vapid = Vapid02()
        vapid.generate_keys()
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        vapid.save_key(str(VAPID_PRIVATE_KEY_PATH))
        logger.info(f"Generated a new VAPID key pair at {VAPID_PRIVATE_KEY_PATH}")

    _vapid = vapid
    return vapid


def get_application_server_key() -> str:
    vapid = _load_or_create_vapid()
    raw = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def send(subscription_info: dict, payload: dict) -> PushResult:
    vapid = _load_or_create_vapid()
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=vapid,
            vapid_claims={"sub": DEFAULT_VAPID_SUBJECT},
        )
        return PushResult(outcome=PushOutcome.DELIVERED)
    except WebPushException as e:
        response = e.response
        if response is not None:
            detail = f"{response.status_code} {response.text}".strip()
            if response.status_code in _GONE_STATUS_CODES:
                return PushResult(outcome=PushOutcome.EXPIRED, detail=detail)
        else:
            detail = str(e)
        logger.warning(f"Push delivery failed: {detail}")
        return PushResult(outcome=PushOutcome.FAILED, detail=detail)
