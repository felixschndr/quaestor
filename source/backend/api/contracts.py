from fastapi import Depends
from sqlalchemy.orm import Session

from source.backend.api.create_router import create_router
from source.backend.api.schemas.contract import (
    ContractAssignRequest,
    ContractCreate,
    ContractDetailRead,
    ContractRead,
    ContractUpdate,
)
from source.backend.db import get_session
from source.backend.models.user import User
from source.backend.services import contract_service, session_service

router = create_router()


@router.post("", response_model=ContractDetailRead, status_code=201)
def create_contract(
    payload: ContractCreate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> ContractDetailRead:
    contract = contract_service.create_contract(
        db_session=db_session,
        user=current_user,
        account_id=payload.account_id,
        fields=payload.model_dump(exclude={"account_id"}),
    )
    return ContractDetailRead.from_contract(contract)


@router.get("", response_model=list[ContractRead])
def list_contracts(
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[ContractRead]:
    contracts = contract_service.list_contracts_for_user(db_session=db_session, user=current_user)
    return [ContractRead.from_contract(contract) for contract in contracts]


@router.get("/{contract_id}", response_model=ContractDetailRead)
def get_contract(
    contract_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> ContractDetailRead:
    contract = contract_service.get_contract_for_user(db_session=db_session, user=current_user, contract_id=contract_id)
    return ContractDetailRead.from_contract(contract)


@router.patch("/{contract_id}", response_model=ContractDetailRead)
def update_contract(
    contract_id: int,
    payload: ContractUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> ContractDetailRead:
    contract = contract_service.update_contract(
        db_session=db_session,
        user=current_user,
        contract_id=contract_id,
        fields=payload.model_dump(exclude_unset=True),
    )
    return ContractDetailRead.from_contract(contract)


@router.delete("/{contract_id}", status_code=204)
def delete_contract(
    contract_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    contract_service.delete_contract(db_session=db_session, user=current_user, contract_id=contract_id)


@router.post("/{contract_id}/transactions", response_model=ContractDetailRead)
def assign_transaction(
    contract_id: int,
    payload: ContractAssignRequest,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> ContractDetailRead:
    contract = contract_service.assign_transaction_to_contract(
        db_session=db_session, user=current_user, contract_id=contract_id, transaction_id=payload.transaction_id
    )
    return ContractDetailRead.from_contract(contract)


@router.delete("/{contract_id}/transactions/{transaction_id}", response_model=ContractDetailRead)
def remove_transaction(
    contract_id: int,
    transaction_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> ContractDetailRead:
    contract = contract_service.remove_transaction(
        db_session=db_session, user=current_user, contract_id=contract_id, transaction_id=transaction_id
    )
    return ContractDetailRead.from_contract(contract)
