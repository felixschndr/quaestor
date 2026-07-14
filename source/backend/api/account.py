from fastapi import Depends, Query
from sqlalchemy.orm import Session

from source.backend.api.create_router import create_router
from source.backend.api.schemas.account import (
    AccountCreate,
    AccountHistory,
    AccountRead,
    AccountUpdate,
)
from source.backend.api.schemas.expected_transaction import (
    ExpectedTransactionCreate,
    ExpectedTransactionRead,
    ExpectedTransactionUpdate,
)
from source.backend.api.schemas.recurring_transaction import (
    RecurringTransactionCreate,
    RecurringTransactionRead,
    RecurringTransactionUpdate,
)
from source.backend.api.schemas.transaction import (
    TransactionCreate,
    TransactionDetailRead,
    TransactionRead,
    TransactionUpdate,
    TransferLinkCreate,
)
from source.backend.db import get_session
from source.backend.models.account import Account
from source.backend.models.recurring_transaction import RecurringTransaction
from source.backend.models.transaction import Transaction
from source.backend.models.user import User
from source.backend.services import (
    account_service,
    credential_service,
    recurring_transaction_service,
    session_service,
)

router = create_router()


@router.post("", response_model=AccountRead, status_code=201)
def create_manual_account(
    payload: AccountCreate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Account:
    credential = credential_service.get_credential_for_user(
        db_session=db_session, credential_id=payload.credential_id, user=current_user
    )
    return account_service.create_manual_account(
        db_session=db_session,
        credential=credential,
        name=payload.name,
        display_name=payload.display_name,
        balance=payload.balance,
        balance_factor=payload.balance_factor,
    )


@router.patch("/{account_id}", response_model=AccountRead)
def update_account(
    account_id: int,
    payload: AccountUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Account:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    return account_service.update_account(
        db_session=db_session, account=account, fields=payload.model_dump(exclude_unset=True)
    )


@router.delete("/{account_id}", status_code=204)
def delete_account(
    account_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    account_service.delete_account(db_session=db_session, account=account)


@router.post("/{account_id}/transactions", response_model=TransactionRead, status_code=201)
def create_transaction(
    account_id: int,
    payload: TransactionCreate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Transaction:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    return account_service.create_manual_transaction(
        db_session=db_session, account=account, fields=payload.model_dump(exclude_unset=True)
    )


@router.delete("/{account_id}/transactions/{transaction_id}", status_code=204)
def delete_transaction(
    account_id: int,
    transaction_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    transaction = account_service.get_transaction_for_account(
        db_session=db_session, account=account, transaction_id=transaction_id
    )
    account_service.delete_transaction(db_session=db_session, account=account, transaction=transaction)


@router.put("/{account_id}/transactions/{transaction_id}/transfer-link", response_model=TransactionDetailRead)
def link_transactions(
    account_id: int,
    transaction_id: int,
    payload: TransferLinkCreate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Transaction:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    transaction = account_service.get_transaction_for_account(
        db_session=db_session, account=account, transaction_id=transaction_id
    )
    counterpart_account = account_service.get_account_for_user(
        db_session=db_session, account_id=payload.counterpart_account_id, user=current_user
    )
    counterpart = account_service.get_transaction_for_account(
        db_session=db_session, account=counterpart_account, transaction_id=payload.counterpart_transaction_id
    )
    account_service.link_transactions(db_session=db_session, transaction=transaction, counterpart=counterpart)
    return transaction


@router.delete("/{account_id}/transactions/{transaction_id}/transfer-link", status_code=204)
def unlink_transactions(
    account_id: int,
    transaction_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    transaction = account_service.get_transaction_for_account(
        db_session=db_session, account=account, transaction_id=transaction_id
    )
    account_service.unlink_transactions(db_session=db_session, transaction=transaction)


@router.get("/{account_id}/transactions/{transaction_id}", response_model=TransactionDetailRead)
def get_transaction(
    account_id: int,
    transaction_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Transaction:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    return account_service.get_transaction_for_account(
        db_session=db_session, account=account, transaction_id=transaction_id
    )


@router.patch("/{account_id}/transactions/{transaction_id}", response_model=TransactionDetailRead)
def update_transaction(
    account_id: int,
    transaction_id: int,
    payload: TransactionUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Transaction:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    transaction = account_service.get_transaction_for_account(
        db_session=db_session, account=account, transaction_id=transaction_id
    )
    return account_service.update_transaction(
        db_session=db_session,
        account=account,
        transaction=transaction,
        fields=payload.model_dump(exclude_unset=True),
    )


@router.post("/{account_id}/recurring-transactions", response_model=RecurringTransactionRead, status_code=201)
def create_recurring_transaction(
    account_id: int,
    payload: RecurringTransactionCreate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> RecurringTransaction:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    fields = payload.model_dump(exclude_unset=True, exclude={"book_immediately"})
    return recurring_transaction_service.create_recurring_transaction(
        db_session=db_session, account=account, fields=fields, book_immediately=payload.book_immediately
    )


@router.get("/{account_id}/recurring-transactions", response_model=list[RecurringTransactionRead])
def list_recurring_transactions(
    account_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[RecurringTransaction]:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    return recurring_transaction_service.list_recurring_transactions(db_session=db_session, account=account)


@router.patch(
    "/{account_id}/recurring-transactions/{recurring_transaction_id}",
    response_model=RecurringTransactionRead,
)
def update_recurring_transaction(
    account_id: int,
    recurring_transaction_id: int,
    payload: RecurringTransactionUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> RecurringTransaction:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    return recurring_transaction_service.update_recurring_transaction(
        db_session=db_session,
        account=account,
        recurring_transaction_id=recurring_transaction_id,
        fields=payload.model_dump(),
    )


@router.delete("/{account_id}/recurring-transactions/{recurring_transaction_id}", status_code=204)
def delete_recurring_transaction(
    account_id: int,
    recurring_transaction_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    recurring_transaction_service.delete_recurring_transaction(
        db_session=db_session, account=account, recurring_transaction_id=recurring_transaction_id
    )


@router.post("/{account_id}/expected-transactions", response_model=ExpectedTransactionRead, status_code=201)
def create_expected_transaction(
    account_id: int,
    payload: ExpectedTransactionCreate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Transaction:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    return account_service.create_expected_transaction(
        db_session=db_session, account=account, fields=payload.model_dump(exclude_unset=True)
    )


@router.get("/{account_id}/expected-transactions", response_model=list[ExpectedTransactionRead])
def list_expected_transactions(
    account_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> list[Transaction]:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    return account_service.list_expected_transactions(db_session=db_session, account=account)


@router.patch(
    "/{account_id}/expected-transactions/{expected_transaction_id}",
    response_model=ExpectedTransactionRead,
)
def update_expected_transaction(
    account_id: int,
    expected_transaction_id: int,
    payload: ExpectedTransactionUpdate,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> Transaction:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    return account_service.update_expected_transaction(
        db_session=db_session,
        account=account,
        expected_transaction_id=expected_transaction_id,
        fields=payload.model_dump(exclude_unset=True),
    )


@router.delete("/{account_id}/expected-transactions/{expected_transaction_id}", status_code=204)
def delete_expected_transaction(
    account_id: int,
    expected_transaction_id: int,
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> None:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    account_service.delete_expected_transaction(
        db_session=db_session, account=account, expected_transaction_id=expected_transaction_id
    )


@router.get("/{account_id}/history", response_model=AccountHistory)
def get_account_history(
    account_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=account_service.DEFAULT_DAYS_PER_PAGE, ge=1, le=account_service.MAX_DAYS_PER_PAGE),
    current_user: User = Depends(session_service.get_current_user_from_request),
    db_session: Session = Depends(get_session),
) -> AccountHistory:
    account = account_service.get_account_for_user(db_session=db_session, account_id=account_id, user=current_user)
    transactions, balance_at_date, total_days = account_service.get_history_page(
        db_session=db_session, account=account, page=page, page_size=page_size
    )
    return AccountHistory(
        transactions=[TransactionRead.model_validate(transaction) for transaction in transactions],
        balance_at_date=balance_at_date,
        page=page,
        page_size=page_size,
        total_days=total_days,
    )
