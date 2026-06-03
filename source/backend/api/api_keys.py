from fastapi import Depends
from source.backend.api.create_router import create_router
from source.backend.api.schemas.api_key import ApiKeyCreate, ApiKeyCreated, ApiKeyRead
from source.backend.db import get_session
from source.backend.models.user import User
from source.backend.services import api_key_service, session_service
from sqlalchemy.orm import Session

router = create_router()


@router.get("", response_model=list[ApiKeyRead])
def list_api_keys(
    current_user: User = Depends(session_service.get_current_user_from_session),
    db_session: Session = Depends(get_session),
) -> list[ApiKeyRead]:
    return [
        ApiKeyRead.model_validate(api_key)
        for api_key in api_key_service.list_api_keys(db_session=db_session, user_id=current_user.id)
    ]


@router.post("", response_model=ApiKeyCreated, status_code=201)
def create_api_key(
    payload: ApiKeyCreate,
    current_user: User = Depends(session_service.get_current_user_from_session),
    db_session: Session = Depends(get_session),
) -> ApiKeyCreated:
    raw_token, api_key = api_key_service.create_api_key(db_session=db_session, user=current_user, name=payload.name)
    return ApiKeyCreated(
        id=api_key.id,
        name=api_key.name,
        prefix=api_key.prefix,
        created_at=api_key.created_at,
        last_used_at=api_key.last_used_at,
        token=raw_token,
    )


@router.delete("/{api_key_id}", status_code=204)
def delete_api_key(
    api_key_id: int,
    current_user: User = Depends(session_service.get_current_user_from_session),
    db_session: Session = Depends(get_session),
) -> None:
    api_key_service.delete_api_key(db_session=db_session, user_id=current_user.id, api_key_id=api_key_id)
