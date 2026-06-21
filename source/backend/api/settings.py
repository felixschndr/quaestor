from pydantic import BaseModel
from source.backend.api.create_router import create_router
from source.backend.services import i18n_service, sync_scheduler, user_service

router = create_router()


class AppSettings(BaseModel):
    allow_new_user_registration: bool
    default_language: str
    display_timezone: str
    sync_interval_hours: float


@router.get("", response_model=AppSettings)
def get_settings() -> AppSettings:
    return AppSettings(
        allow_new_user_registration=user_service.new_user_registration_allowed(),
        default_language=i18n_service.get_default_language(),
        display_timezone=i18n_service.get_display_timezone(),
        sync_interval_hours=sync_scheduler.sync_interval_hours(),
    )
