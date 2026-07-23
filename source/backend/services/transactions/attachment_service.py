import os
from pathlib import PurePosixPath

from sqlalchemy.orm import Session

from source.backend.exceptions import (
    FileTooLargeError,
    TransactionNotFoundError,
    UnsupportedFileTypeError,
    ValidationError,
)
from source.backend.helpers import utc_now
from source.backend.logging_utils import get_logger
from source.backend.models.transactions.transaction import Transaction
from source.backend.models.transactions.transaction_attachment import (
    TransactionAttachment,
)

logger = get_logger(__name__)

MAX_ATTACHMENT_SIZE_MB_ENV_VARIABLE_NAME = "MAX_ATTACHMENT_SIZE_MB"
DEFAULT_MAX_ATTACHMENT_SIZE_MB = 20

ALLOWED_EXTENSIONS = frozenset(
    {
        "pdf",
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "heic",
        "doc",
        "docx",
        "xls",
        "xlsx",
        "csv",
        "txt",
        "xml",
        "odt",
        "ods",
    }
)


def max_attachment_size_mb() -> int:
    return int(os.environ.get("MAX_ATTACHMENT_SIZE_MB") or DEFAULT_MAX_ATTACHMENT_SIZE_MB)


def max_attachment_size_bytes() -> int:
    return max_attachment_size_mb() * 1024 * 1024


def _get_file_extension(filename: str) -> str:
    return PurePosixPath(filename).suffix.lstrip(".").lower()


def reject_if_too_large(size: int | None) -> None:
    limit = max_attachment_size_bytes()
    if size is not None and size > limit:
        raise FileTooLargeError(f"File exceeds the maximum size of {limit // (1024 * 1024)} MB")


def _validate(filename: str, size: int) -> None:
    extension = _get_file_extension(filename)
    if extension not in ALLOWED_EXTENSIONS:
        raise UnsupportedFileTypeError(f"File type '.{extension}' is not allowed")
    reject_if_too_large(size=size)
    if size == 0:
        raise ValidationError("File is empty")


def list_attachments(transaction: Transaction) -> list[TransactionAttachment]:
    return sorted(transaction.attachments, key=lambda attachment: attachment.id)


def create_attachment(
    db_session: Session, transaction: Transaction, filename: str, content_type: str | None, data: bytes
) -> TransactionAttachment:
    _validate(filename=filename, size=len(data))
    attachment = TransactionAttachment(
        transaction_id=transaction.id,
        filename=filename,
        content_type=content_type,
        size=len(data),
        data=data,
        created_at=utc_now(),
    )
    db_session.add(attachment)
    db_session.commit()
    db_session.refresh(attachment)
    logger.info(f"Added {attachment} to {transaction}")
    return attachment


def get_attachment(db_session: Session, transaction: Transaction, attachment_id: int) -> TransactionAttachment:
    not_found = TransactionNotFoundError(f"Attachment with the ID {attachment_id} not found")
    attachment = db_session.get(entity=TransactionAttachment, ident=attachment_id)
    if attachment is None or attachment.transaction_id != transaction.id:
        logger.warning(f"Attachment {attachment_id} not found on {transaction}")
        raise not_found
    return attachment


def delete_attachment(db_session: Session, transaction: Transaction, attachment_id: int) -> None:
    attachment = get_attachment(db_session=db_session, transaction=transaction, attachment_id=attachment_id)
    db_session.delete(attachment)
    db_session.commit()
    logger.info(f"Deleted attachment {attachment.filename!r} from {transaction}")
