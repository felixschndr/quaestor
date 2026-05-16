from fastapi import APIRouter, Depends
from source.api.schemas import ApplicationSecretRead, ApplicationSecretUpdate
from source.db import get_session
from source.services import application_secret_service
from sqlalchemy.orm import Session

router = APIRouter(prefix="/application_secrets", tags=["application_secrets"])


@router.get("", response_model=list[ApplicationSecretRead])
def list_all_secrets(session: Session = Depends(get_session)) -> list[dict]:
    return application_secret_service.list_all_application_secrets(session=session)


@router.post("", response_model=ApplicationSecretRead, status_code=201)
def update_application_secret(payload: ApplicationSecretUpdate, session: Session = Depends(get_session)) -> dict:
    return application_secret_service.update_application_secret(name=payload.name, value=payload.value, session=session)
