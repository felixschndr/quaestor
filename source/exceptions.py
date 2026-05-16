class NotFoundError(Exception):
    pass


class UserNotFoundError(NotFoundError):
    pass


class CredentialNotFoundError(NotFoundError):
    pass


class AccountNotFoundError(NotFoundError):
    pass


class ApplicationSecretNotFoundError(NotFoundError):
    pass
