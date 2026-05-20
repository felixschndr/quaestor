class NotFoundError(Exception):
    pass


class UserNotFoundError(NotFoundError):
    pass


class ApplicationSecretNotFoundError(NotFoundError):
    pass


class AccountNotFoundError(NotFoundError):
    pass


class CredentialNotFoundError(NotFoundError):
    pass


class SessionNotFoundError(NotFoundError):
    pass


class ValidationError(Exception):
    pass


class MissingCredentialFieldError(ValidationError):
    pass


class InvalidTwoFactorError(ValidationError):
    pass


class CannotRevokeCurrentSessionError(ValidationError):
    pass


class ReauthenticationRequiredError(Exception):
    pass


class InvalidCredentialsError(Exception):
    pass


class UnknownInternalError(Exception):
    pass


class PermissionDeniedError(Exception):
    pass
