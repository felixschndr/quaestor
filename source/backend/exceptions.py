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
