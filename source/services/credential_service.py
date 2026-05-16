from source.bank_handlers import SUPPORTED_BANKS, BankProvider
from source.exceptions import CredentialNotFoundError
from source.models.credential import Credential
from source.services import user_service
from sqlalchemy import select
from sqlalchemy.orm import Session


def list_all_possible() -> list[dict]:
    return [
        {
            "Bank Name": bank.name,
            "Bank Identifier": bank.bank_identifier,
            "Required Fields": bank.required_fields,
        }
        for bank in SUPPORTED_BANKS
    ]


def list_credentials(session: Session, user_id: int) -> list[Credential]:
    return list(session.scalars(select(Credential).where(Credential.user_id == user_id)))


def get_credential(session: Session, credential_id: int) -> Credential:
    credential = session.get(Credential, credential_id)
    if credential is None:
        raise CredentialNotFoundError(f"Credential with the id {credential_id} not found")
    return credential


def create_credential(session: Session, user_id: int, bank: BankProvider, username: str, password: str) -> Credential:
    user = user_service.get_user(session, user_id)
    credential = Credential(user=user, bank=bank, username=username, password=password)
    session.add(credential)
    session.commit()
    return credential


def update_credential(session: Session, credential_id: int, fields: dict) -> Credential:
    credential = get_credential(session, credential_id)
    for key, value in fields.items():
        setattr(credential, key, value)
    session.commit()
    return credential


def delete_credential(session: Session, credential_id: int) -> None:
    credential = get_credential(session, credential_id)
    session.delete(credential)
    session.commit()


def sync_credential(session: Session, credential_id: int) -> None:
    credential = get_credential(session, credential_id)
    credential.sync()
    session.commit()
