from source.models.application_secret import ApplicationSecret
from sqlalchemy import select
from sqlalchemy.orm import Session


def list_all_secrets(session: Session) -> list[dict]:
    all_secrets = session.execute(select(ApplicationSecret.id, ApplicationSecret.name)).all()
    return [{"id": secret.id, "name": secret.name} for secret in all_secrets]


def create_application_secret(name: str, value: str, session: Session) -> dict:
    application_secret = ApplicationSecret(name=name, value=value)
    session.add(application_secret)
    session.commit()
    return {"id": application_secret.id, "name": application_secret.name}
