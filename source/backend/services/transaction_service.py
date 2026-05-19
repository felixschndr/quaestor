from source.backend.logging_utils import get_logger
from source.backend.models.transaction import Transaction
from sqlalchemy import func, select
from sqlalchemy.orm import Session

logger = get_logger(__name__)

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


def list_transactions(
    db_session: Session, account_id: int, page: int = 1, page_size: int = DEFAULT_PAGE_SIZE
) -> tuple[list[Transaction], int]:
    total = (
        db_session.scalar(select(func.count()).select_from(Transaction).where(Transaction.account_id == account_id))
        or 0
    )
    stmt = (
        select(Transaction)
        .where(Transaction.account_id == account_id)
        .order_by(Transaction.date.desc())
        .order_by(Transaction.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    transactions = list(db_session.scalars(stmt))
    logger.debug(
        f"Found {len(transactions)} of {total} transaction(s) for account {account_id} "
        f"(page {page}, page size {page_size})"
    )
    return transactions, total
