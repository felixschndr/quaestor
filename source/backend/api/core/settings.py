from pydantic import BaseModel

from source.backend.api.core.create_router import create_router
from source.backend.models.contracts import contract as contract_model
from source.backend.models.notifications import notification_rule as notification_rule_model
from source.backend.services.auth import user_service
from source.backend.services.banking import sync_scheduler
from source.backend.services.core import i18n_service
from source.backend.services.transactions import attachment_service

router = create_router()


class AppSettings(BaseModel):
    allow_new_user_registration: bool
    default_language: str
    default_currency: str
    display_timezone: str
    sync_interval_hours: float
    allowed_attachment_extensions: list[str]
    max_attachment_size_mb: int
    trigger_default_days: dict[str, int]
    default_digest_weekday: int


@router.get("", response_model=AppSettings)
def get_settings() -> AppSettings:
    return AppSettings(
        allow_new_user_registration=user_service.new_user_registration_allowed(),
        default_language=i18n_service.get_default_language(),
        default_currency=i18n_service.get_default_currency(),
        display_timezone=i18n_service.get_display_timezone(),
        sync_interval_hours=sync_scheduler.sync_interval_hours(),
        allowed_attachment_extensions=sorted(attachment_service.ALLOWED_EXTENSIONS),
        max_attachment_size_mb=attachment_service.max_attachment_size_mb(),
        trigger_default_days={
            "contract_overdue": contract_model.OVERDUE_GRACE_DAYS,
            "contract_ending": contract_model.ENDING_LEAD_DAYS,
            "duplicate_transaction": contract_model.DUPLICATE_WINDOW_DAYS,
            "upcoming_shortfall": contract_model.SHORTFALL_LOOKAHEAD_DAYS,
        },
        default_digest_weekday=notification_rule_model.DEFAULT_DIGEST_WEEKDAY,
    )
