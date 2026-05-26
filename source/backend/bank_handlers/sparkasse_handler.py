import time
from contextlib import contextmanager
from time import sleep
from typing import Iterator

import fints_url
from fints.client import FinTS3PinTanClient, NeedTANResponse
from source.backend.bank_handlers.fints_handler import FinTSHandler, _FinTSSession
from source.backend.exceptions import (
    InvalidCredentialsError,
    ReauthenticationRequiredError,
)
from source.backend.logging_utils import get_logger

logger = get_logger(__name__)

APPROVAL_TIMEOUT_SECONDS = 180
APPROVAL_POLL_INTERVAL_SECONDS = 2.0


class SparkasseHandler(FinTSHandler):
    # BLZ is provided by the user since every Sparkasse has its own bank code & FinTS server.
    CREDENTIAL_FIELDS = ("blz", "username", "password")

    def client(self, user_id: str, pin: str) -> FinTS3PinTanClient:
        blz = self.credentials["blz"]
        try:
            url = fints_url.find(bank_code=blz)
        except Exception as e:
            error_message = f"No FinTS server known for BLZ {blz}: {e}"
            logger.warning(error_message)
            raise InvalidCredentialsError(error_message) from e
        logger.debug(f"Resolved FinTS URL for BLZ {blz}: {url}")
        return FinTS3PinTanClient(
            bank_identifier=blz,
            user_id=user_id,
            pin=pin,
            server=url,
            product_id=self.FINTS_PRODUCT_ID,
        )

    @contextmanager
    def session(self) -> Iterator[_FinTSSession]:
        blz = self.credentials["blz"]
        logger.debug(f"Opening Sparkasse FinTS session for BLZ {blz}")
        client = self.client(user_id=self.credentials["username"], pin=self.credentials["password"])
        # TAN mechanism selection must happen BEFORE the dialog opens (`with client:`).
        _configure_pushtan_mechanism(client)
        with client:
            _wait_for_decoupled_approval(client)
            yield _FinTSSession(client)


def _configure_pushtan_mechanism(client: FinTS3PinTanClient) -> None:
    client.fetch_tan_mechanisms()
    mechanisms = client.get_tan_mechanisms()
    push_entry = next(
        ((sec_func, mech) for sec_func, mech in mechanisms.items() if "push" in mech.name.lower()),
        None,
    )
    if push_entry is None:
        available = ", ".join(f"{sec_func}={mech.name}" for sec_func, mech in mechanisms.items())
        error_message = f"Sparkasse did not advertise a pushTAN mechanism. Available mechanisms: {available}"
        logger.warning(error_message)
        raise ReauthenticationRequiredError(error_message)
    sec_func, mechanism = push_entry
    logger.debug(f"Using TAN mechanism {sec_func}: {mechanism.name}")
    client.set_tan_mechanism(sec_func)
    # Some Sparkassen require selecting a specific TAN medium (registered device) before the dialog opens.
    description_required = getattr(mechanism, "description_required", None)
    if description_required is not None and str(description_required) == "MUST":
        media = list(client.get_tan_media())
        if not media:
            error_message = "Sparkasse requires a TAN medium but none was returned"
            logger.warning(error_message)
            raise ReauthenticationRequiredError(error_message)
        client.set_tan_medium(media[0])


def _wait_for_decoupled_approval(client: FinTS3PinTanClient) -> None:
    if not isinstance(client.init_tan_response, NeedTANResponse):
        return
    if not client.init_tan_response.decoupled:
        error_message = "Sparkasse advertised a non-decoupled TAN mechanism; only pushTAN app approval is supported"
        logger.warning(error_message)
        raise ReauthenticationRequiredError(error_message)

    deadline = time.monotonic() + APPROVAL_TIMEOUT_SECONDS
    logger.info(f"Waiting for Sparkasse pushTAN app approval (up to {APPROVAL_TIMEOUT_SECONDS} s)")
    while isinstance(client.init_tan_response, NeedTANResponse):
        if time.monotonic() > deadline:
            error_message = f"Sparkasse pushTAN approval did not arrive within {APPROVAL_TIMEOUT_SECONDS} seconds"
            logger.warning(error_message)
            raise ReauthenticationRequiredError(error_message)
        sleep(APPROVAL_POLL_INTERVAL_SECONDS)
        client.init_tan_response = client.send_tan(client.init_tan_response, tan="")
    logger.info("Sparkasse pushTAN approval received")
