import logging

from source.backend.exceptions import ApplicationSettingNotFoundError
from source.backend.models.application_settings import ApplicationSetting
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

ALLOW_NEW_USER_REGISTRATION_SETTING_NAME = "Allow new user registration"


def _get_application_setting_by_name(name: str, db_session: Session) -> ApplicationSetting:
    application_setting = db_session.scalar(select(ApplicationSetting).where(ApplicationSetting.name == name))
    if application_setting is None:
        error_message = f"Application setting with the name {name} not found"
        logger.warning(error_message)
        raise ApplicationSettingNotFoundError(error_message)
    logger.debug(f'Loaded application setting "{name}"')
    return application_setting


def get_value_of_application_setting_by_name(name: str, db_session: Session) -> str:
    logger.debug(f'Reading value of application setting "{name}"')
    return _get_application_setting_by_name(name=name, db_session=db_session).value


def list_all_application_settings(db_session: Session) -> list[ApplicationSetting]:
    all_settings = list(db_session.scalars(select(ApplicationSetting)))
    logger.debug(f"Found {len(all_settings)} application setting(s)")
    return all_settings


def update_application_setting(name: str, value: str, db_session: Session) -> ApplicationSetting:
    application_setting = _get_application_setting_by_name(name=name, db_session=db_session)
    application_setting.value = value
    db_session.commit()
    logger.info(f'Updated application setting "{name}"')
    return application_setting
