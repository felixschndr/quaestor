from fastapi import Depends
from source.backend.api._create_router import create_router
from source.backend.api.schemas.application_secret import (
    ApplicationSecretRead,
    ApplicationSecretUpdate,
)
from source.backend.db import get_session
from source.backend.models.user import User
from source.backend.services import application_secret_service, session_service
from sqlalchemy.orm import Session

router = create_router()


@router.get("", response_model=list[ApplicationSecretRead])
def list_all_secrets(
    _: User = Depends(session_service.get_current_user_from_request_if_is_admin),
    db_session: Session = Depends(get_session),
) -> list[dict]:
    return application_secret_service.list_all_application_secrets(db_session=db_session)


@router.post("", response_model=ApplicationSecretRead, status_code=201)
def update_application_secret(
    payload: ApplicationSecretUpdate,
    _: User = Depends(session_service.get_current_user_from_request_if_is_admin),
    db_session: Session = Depends(get_session),
) -> dict:
    return application_secret_service.update_application_secret(
        name=payload.name, value=payload.value, db_session=db_session
    )
