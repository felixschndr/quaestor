import logging

from source.exceptions import ApplicationSecretNotFoundError
from source.models.application_secret import ApplicationSecret
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _get_application_secret_by_name(name: str, session: Session) -> ApplicationSecret:
    secret = session.scalar(select(ApplicationSecret).where(ApplicationSecret.name == name))
    if secret is None:
        error_message = f"Application secret with the name {name} not found"
        logger.warning(error_message)
        raise ApplicationSecretNotFoundError(error_message)
    logger.debug(f'Loaded application secret "{name}"')
    return secret


def get_value_of_application_secret_by_name(name: str, session: Session) -> str:
    logger.debug(f'Reading value of application secret "{name}"')  # value intentionally not logged
    return _get_application_secret_by_name(name, session).value


def list_all_application_secrets(session: Session) -> list[dict]:
    all_secrets = session.execute(select(ApplicationSecret.id, ApplicationSecret.name)).all()
    logger.debug(f"Found {len(all_secrets)} application secret(s)")
    return [{"id": secret.id, "name": secret.name} for secret in all_secrets]


def update_application_secret(name: str, value: str, session: Session) -> dict:
    application_secret = _get_application_secret_by_name(name, session)
    application_secret.value = value
    session.commit()
    logger.info(f'Updated application secret "{name}"')
    return {"id": application_secret.id, "name": application_secret.name}
