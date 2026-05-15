from source.models.credential import Credential
from sqlalchemy.orm import Session


def sync_credential_accounts(session: Session, credential: Credential) -> None:
    """Refresh every account (and in the future its transactions) behind a credential."""
    credential.sync()
    session.commit()
