from source.backend.exceptions import ContractNotFoundError
from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.account import Account
from source.backend.models.contract import Contract
from source.backend.models.contract_assignment import ContractAssignment
from source.backend.models.contract_source import ContractSource
from source.backend.models.credential import Credential
from source.backend.models.transaction import Transaction
from source.backend.models.user import User
from source.backend.services import account_service
from source.backend.services.contract_aggregators import compute_fingerprint
from source.backend.services.contract_detection_service import (
    apply_contract_category_to_members,
    recompute_contract_stats,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = get_logger(__name__)


def create_contract(db_session: Session, user: User, account_id: int, fields: dict) -> Contract:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=user)
    contract = Contract(
        account=account,
        name=fields["name"],
        category=fields.get("category"),
        frequency=fields.get("frequency"),
        source=ContractSource.MANUAL,
        created_at=utc_now(),
    )
    db_session.add(contract)
    db_session.commit()
    logger.info(f"Created manual {contract} on {account}")
    return contract


def list_contracts_for_user(db_session: Session, user: User) -> list[Contract]:
    contracts = list(
        db_session.scalars(
            select(Contract)
            .join(Account, onclause=Contract.account_id == Account.id)
            .join(Credential, onclause=Account.credential_id == Credential.id)
            .where(Credential.user_id == user.id)
            .order_by(Contract.created_at.desc())
        )
    )
    logger.debug(f"Found {len(contracts)} contract(s) for {user}")
    return contracts


def get_contract_for_user(db_session: Session, user: User, contract_id: int) -> Contract:
    error_message = f"Contract with the ID {contract_id} not found"
    contract = db_session.get(entity=Contract, ident=contract_id)
    if contract is None:
        logger.warning(error_message)
        raise ContractNotFoundError(error_message)
    if contract.account.credential.user_id != user.id:
        logger.warning(f"{user} attempted to access {contract} owned by user {contract.account.credential.user_id}")
        raise ContractNotFoundError(error_message)
    logger.debug(f"{user} accessed {contract}")
    return contract


def update_contract(db_session: Session, user: User, contract_id: int, fields: dict) -> Contract:
    contract = get_contract_for_user(db_session=db_session, user=user, contract_id=contract_id)
    contract.name = fields["name"]
    if "category" in fields:
        category_changed = contract.category != fields["category"]
        contract.category = fields["category"]
        if category_changed:
            apply_contract_category_to_members(contract)
    if "note" in fields:
        contract.note = fields["note"]
    if "frequency" in fields:
        contract.frequency = fields["frequency"]
        recompute_contract_stats(contract)
    db_session.commit()
    logger.info(f"Updated {contract}")
    return contract


def delete_contract(db_session: Session, user: User, contract_id: int) -> None:
    contract = get_contract_for_user(db_session=db_session, user=user, contract_id=contract_id)
    db_session.delete(contract)
    db_session.commit()
    logger.info(f"Deleted contract {contract_id}")


def assign_transaction_to_contract(db_session: Session, user: User, contract_id: int, transaction_id: int) -> Contract:
    contract = get_contract_for_user(db_session=db_session, user=user, contract_id=contract_id)
    transaction = _get_owned_transaction_on_same_account(
        db_session=db_session, contract=contract, transaction_id=transaction_id
    )
    previous_contract = transaction.contract if transaction.contract_id not in (None, contract.id) else None
    transaction.contract_id = contract.id
    transaction.contract_assignment = ContractAssignment.MANUAL
    if contract.fingerprint is None:
        fingerprint = compute_fingerprint(transaction)
        if fingerprint is not None:
            contract.fingerprint = f"{fingerprint.key}:manual-{contract.id}"
    db_session.flush()
    recompute_contract_stats(contract)
    if previous_contract is not None:
        recompute_contract_stats(previous_contract)
    db_session.commit()
    logger.info(f"Assigned {transaction} to {contract}")
    return contract


def remove_transaction(db_session: Session, user: User, contract_id: int, transaction_id: int) -> Contract:
    contract = get_contract_for_user(db_session=db_session, user=user, contract_id=contract_id)
    transaction = _get_owned_transaction_on_same_account(
        db_session=db_session, contract=contract, transaction_id=transaction_id
    )
    transaction.contract_assignment = ContractAssignment.EXCLUDED
    transaction.contract_id = None
    db_session.flush()
    recompute_contract_stats(contract)
    db_session.commit()
    logger.info(f"Removed {transaction} from {contract}")
    return contract


def _get_owned_transaction_on_same_account(db_session: Session, contract: Contract, transaction_id: int) -> Transaction:
    return account_service.get_transaction_for_account(
        db_session=db_session, account=contract.account, transaction_id=transaction_id
    )
