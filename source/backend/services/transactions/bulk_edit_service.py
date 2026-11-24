from sqlalchemy.orm import Session

from source.backend.exceptions import ValidationError
from source.backend.logging_utils import get_logger
from source.backend.models.auth.user import User
from source.backend.models.transactions.transaction import Transaction
from source.backend.services.accounts import account_service
from source.backend.services.contracts import contract_service

logger = get_logger(__name__)

CONTRACT_FIELD = "contract_id"


def bulk_update_transactions(db_session: Session, user: User, transaction_ids: list[int], fields: dict) -> None:
    edited_fields = set(fields)
    fields = dict(fields)
    changes_contract = CONTRACT_FIELD in fields
    contract_id = fields.pop(CONTRACT_FIELD, None)
    contract = (
        contract_service.get_contract_for_user(db_session=db_session, user=user, contract_id=contract_id)
        if contract_id is not None
        else None
    )
    transactions = [
        _editable_transaction(
            db_session=db_session, user=user, transaction_id=transaction_id, edited_fields=edited_fields
        )
        for transaction_id in dict.fromkeys(transaction_ids)
    ]
    if contract is not None:
        foreign = [transaction for transaction in transactions if transaction.account_id != contract.account_id]
        if foreign:
            raise ValidationError(f"{len(foreign)} transaction(s) don't belong to the account of {contract}")

    try:
        contract_changes = []
        states_before_update = []
        for transaction in transactions:
            if contract is not None:
                contract_service.attach_transaction(db_session=db_session, contract=contract, transaction=transaction)
                contract_changes.append(f"Assigned {transaction} to {contract}")
            elif changes_contract and transaction.contract is not None:
                previous_contract = transaction.contract
                contract_service.detach_transaction(
                    db_session=db_session, contract=previous_contract, transaction=transaction
                )
                contract_changes.append(f"Removed {transaction} from {previous_contract}")
            if fields:
                states_before_update.append(
                    account_service.apply_transaction_update(
                        db_session=db_session, account=transaction.account, transaction=transaction, fields=dict(fields)
                    )
                )
        db_session.commit()
    except Exception:
        db_session.rollback()
        logger.warning(f"Bulk update of {len(transactions)} transaction(s) of {user} failed; rolled back all changes")
        raise

    for contract_change in contract_changes:
        logger.info(contract_change)
    for transaction, state_before_update in zip(transactions, states_before_update):
        logger.update(state_before_update=state_before_update, entity_after_update=transaction)
    logger.info(f"Bulk-updated {len(transactions)} transaction(s) of {user}: {sorted(edited_fields)}")


def _editable_transaction(db_session: Session, user: User, transaction_id: int, edited_fields: set[str]) -> Transaction:
    transaction = account_service.get_transaction_for_user(
        db_session=db_session, transaction_id=transaction_id, user=user
    )
    account_service.require_writable_account(account=transaction.account, user=user)
    account_service.require_editable_fields(account=transaction.account, user=user, fields=edited_fields)
    account_service.require_editable_transaction(transaction)
    return transaction
