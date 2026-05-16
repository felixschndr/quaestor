from source.exceptions import ApplicationSecretNotFoundError
from source.models.application_secret import ApplicationSecret
from sqlalchemy import select
from sqlalchemy.orm import Session


def _get_application_secret_by_name(name: str, session: Session) -> ApplicationSecret:
    secret = session.scalar(select(ApplicationSecret).where(ApplicationSecret.name == name))
    if secret is None:
        raise ApplicationSecretNotFoundError(f"Application secret with the name {name} not found")
    return secret


def list_all_application_secrets(session: Session) -> list[dict]:
    all_secrets = session.execute(select(ApplicationSecret.id, ApplicationSecret.name)).all()
    return [{"id": secret.id, "name": secret.name} for secret in all_secrets]


def update_application_secret(name: str, value: str, session: Session) -> dict:
    application_secret = _get_application_secret_by_name(name, session)
    application_secret.value = value
    session.commit()
    return {"id": application_secret.id, "name": application_secret.name}
