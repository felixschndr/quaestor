from fastapi import Depends, Request, Response
from source.backend.api.create_router import create_router
from source.backend.api.schemas.user import (
    MIN_PASSWORD_LENGTH,
    PASSWORD_RULES,
    PasswordRequirements,
    PasswordRule,
    RegistrationAllowed,
    UserCreate,
    UserLogin,
    UserRead,
)
from source.backend.db import get_session
from source.backend.exceptions import (
    InvalidCredentialsError,
    PermissionDeniedError,
    UserNotFoundError,
)
from source.backend.logging_utils import get_logger
from source.backend.models.user import User
from source.backend.services import session_service, user_service
from source.backend.services.password_service import verify_password
from sqlalchemy.orm import Session

router = create_router()

logger = get_logger(__name__)


@router.post("/register", response_model=UserRead, status_code=201)
def register(payload: UserCreate, response: Response, db_session: Session = Depends(get_session)) -> User:
    if not user_service.new_user_registration_allowed():
        raise PermissionDeniedError("New user registration is currently disabled")

    user = user_service.create_user(
        db_session=db_session, user_name=payload.user_name, display_name=payload.display_name, password=payload.password
    )
    logger.info(f"Registered {user}")
    raw_token = session_service.create_session(db_session=db_session, user=user, remember_me=True)
    session_service.set_session_cookie(response=response, raw_token=raw_token, remember_me=True)
    return user


@router.post("/login", response_model=UserRead)
def login(payload: UserLogin, response: Response, db_session: Session = Depends(get_session)) -> User:
    error_message_in_case_of_invalid_credentials = "Invalid name or password"
    try:
        user = user_service.get_user_by_user_name(db_session=db_session, user_name=payload.user_name)
    except UserNotFoundError:
        raise InvalidCredentialsError(error_message_in_case_of_invalid_credentials)
    if not verify_password(password_hash=user.password_hash, password_to_verify=payload.password):
        raise InvalidCredentialsError(error_message_in_case_of_invalid_credentials)

    raw_token = session_service.create_session(db_session=db_session, user=user, remember_me=payload.remember_me)
    session_service.set_session_cookie(response=response, raw_token=raw_token, remember_me=payload.remember_me)
    return user


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(session_service.get_current_user_from_request)) -> User:
    return current_user


@router.get("/registration_allowed", response_model=RegistrationAllowed)
def registration_allowed() -> RegistrationAllowed:
    return RegistrationAllowed(allowed=user_service.new_user_registration_allowed())


@router.get("/password_requirements", response_model=PasswordRequirements)
def password_requirements() -> PasswordRequirements:
    return PasswordRequirements(
        min_length=MIN_PASSWORD_LENGTH,
        rules=[
            PasswordRule(name=name, regex=pattern.pattern, description=description)
            for name, (pattern, description) in PASSWORD_RULES.items()
        ],
    )


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db_session: Session = Depends(get_session)) -> None:
    raw_token = request.cookies.get(session_service.COOKIE_NAME)
    if raw_token:
        session_service.delete_session(db_session=db_session, raw_token=raw_token)
    session_service.clear_session_cookie(response)
