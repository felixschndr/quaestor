from enum import Enum


class NotFoundError(Exception):
    pass


class UserNotFoundError(NotFoundError):
    pass


class AccountNotFoundError(NotFoundError):
    pass


class CredentialNotFoundError(NotFoundError):
    pass


class SessionNotFoundError(NotFoundError):
    pass


class TransactionNotFoundError(NotFoundError):
    pass


class ApiKeyNotFoundError(NotFoundError):
    pass


class RecurringTransactionNotFoundError(NotFoundError):
    pass


class ExpectedTransactionNotFoundError(NotFoundError):
    pass


class NotificationRuleNotFoundError(NotFoundError):
    pass


class ContractNotFoundError(NotFoundError):
    pass


class ValidationError(Exception):
    pass


class FileTooLargeError(Exception):
    pass


class UnsupportedFileTypeError(Exception):
    pass


class MissingCredentialFieldError(ValidationError):
    pass


class InvalidCredentialFieldError(ValidationError):
    pass


class InvalidTwoFactorError(ValidationError):
    pass


class CannotRevokeCurrentSessionError(ValidationError):
    pass


class ReauthenticationRequiredError(Exception):
    pass


class InvalidCredentialsError(Exception):
    pass


class UnsupportedBankError(Exception):
    pass


class SyncCancelledError(Exception):
    pass


class BankRateLimitedError(Exception):
    pass


class PSD2ApplicationNotActivatedError(Exception):
    pass


class PSD2RedirectUrlNotAllowedError(Exception):
    pass


class UnknownInternalError(Exception):
    pass


class PermissionDeniedError(Exception):
    pass


class ConflictError(Exception):
    pass


class UserNameAlreadyExistsError(ConflictError):
    pass


class CredentialAlreadyExistsError(ConflictError):
    pass


class JobErrorCode(str, Enum):
    CANCELLED = "cancelled"
    INVALID_CREDENTIALS = "invalid_credentials"
    UNSUPPORTED_BANK = "unsupported_bank"
    RATE_LIMITED = "rate_limited"
    REDIRECT_URL_NOT_ALLOWED = "redirect_url_not_allowed"
    APPLICATION_NOT_ACTIVATED = "application_not_activated"
    UNKNOWN = "unknown"


_ERROR_CODES_BY_EXCEPTION: dict[type[Exception], JobErrorCode] = {
    InvalidCredentialsError: JobErrorCode.INVALID_CREDENTIALS,
    UnsupportedBankError: JobErrorCode.UNSUPPORTED_BANK,
    BankRateLimitedError: JobErrorCode.RATE_LIMITED,
    PSD2RedirectUrlNotAllowedError: JobErrorCode.REDIRECT_URL_NOT_ALLOWED,
    PSD2ApplicationNotActivatedError: JobErrorCode.APPLICATION_NOT_ACTIVATED,
}
KNOWN_SYNC_ERROR_TYPES: tuple[type[Exception], ...] = tuple(_ERROR_CODES_BY_EXCEPTION)


def error_code_for(exc: Exception) -> JobErrorCode:
    return _ERROR_CODES_BY_EXCEPTION.get(type(exc)) or JobErrorCode.UNKNOWN


def error_message_for(exc: BaseException) -> str:
    messages: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        name = type(current).__name__
        message = str(current)
        messages.append(f"{name}: {message}" if message else name)
        current = current.__cause__ or current.__context__
    return "\n".join(reversed(messages))
