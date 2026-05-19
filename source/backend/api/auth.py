from fastapi import APIRouter, Depends, Request, Response
from source.backend.api.schemas.user import UserCreate, UserLogin, UserRead
from source.backend.db import get_session
from source.backend.exceptions import (
    InvalidCredentialsError,
    PermissionDeniedError,
    UserNotFoundError,
)
from source.backend.models.user import User
from source.backend.services import (
    application_setting_service,
    session_service,
    user_service,
)
from source.backend.services.password_service import verify_password
from sqlalchemy.orm import Session

router = APIRouter(tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=201)
def register(payload: UserCreate, response: Response, db_session: Session = Depends(get_session)) -> User:
    registration_allowed = application_setting_service.get_value_of_application_setting_by_name(
        name=application_setting_service.ALLOW_NEW_USER_REGISTRATION_SETTING_NAME, db_session=db_session
    )
    if registration_allowed.lower() != "true":
        raise PermissionDeniedError("New user registration is currently disabled")

    user = user_service.create_user(db_session=db_session, name=payload.name, password=payload.password)
    raw_token = session_service.create_session(db_session=db_session, user=user)
    session_service.set_session_cookie(response=response, raw_token=raw_token)
    return user


@router.post("/login", response_model=UserRead)
def login(payload: UserLogin, response: Response, db_session: Session = Depends(get_session)) -> User:
    error_message_in_case_of_invalid_credentials = "Invalid name or password"
    try:
        user = user_service.get_user_by_name(db_session=db_session, name=payload.name)
    except UserNotFoundError:
        raise InvalidCredentialsError(error_message_in_case_of_invalid_credentials)
    if not verify_password(password_hash=user.password_hash, password_to_verify=payload.password):
        raise InvalidCredentialsError(error_message_in_case_of_invalid_credentials)

    raw_token = session_service.create_session(db_session=db_session, user=user)
    session_service.set_session_cookie(response=response, raw_token=raw_token)
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db_session: Session = Depends(get_session)) -> None:
    raw_token = request.cookies.get(session_service.COOKIE_NAME)
    if raw_token:
        session_service.delete_session(db_session=db_session, raw_token=raw_token)
    session_service.clear_session_cookie(response)
