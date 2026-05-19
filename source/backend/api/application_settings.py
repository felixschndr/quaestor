from fastapi import Depends
from source.backend.api.create_router import create_router
from source.backend.api.schemas.application_setting import (
    ApplicationSettingRead,
    ApplicationSettingUpdate,
)
from source.backend.db import get_session
from source.backend.models.application_settings import ApplicationSetting
from source.backend.models.user import User
from source.backend.services import application_setting_service, session_service
from sqlalchemy.orm import Session

router = create_router()


@router.get("", response_model=list[ApplicationSettingRead])
def list_all_settings(
    _: User = Depends(session_service.get_current_user_from_request_if_is_admin),
    db_session: Session = Depends(get_session),
) -> list[ApplicationSetting]:
    return application_setting_service.list_all_application_settings(db_session=db_session)


@router.post("", response_model=ApplicationSettingRead, status_code=201)
def update_application_setting(
    payload: ApplicationSettingUpdate,
    _: User = Depends(session_service.get_current_user_from_request_if_is_admin),
    db_session: Session = Depends(get_session),
) -> ApplicationSetting:
    return application_setting_service.update_application_setting(
        name=payload.name, value=payload.value, db_session=db_session
    )
