from pydantic import BaseModel


class TwoFactorSetupRead(BaseModel):
    secret: str
    otpauth_uri: str
    qr_code: str  # SVG data URI, ready to drop into an <img src>


class TwoFactorEnableRequest(BaseModel):
    code: str


class BackupCodesRead(BaseModel):
    backup_codes: list[str]


class TwoFactorDisableRequest(BaseModel):
    code: str


class TwoFactorRequired(BaseModel):
    two_factor_required: bool = True
    challenge_token: str


class TwoFactorChallengeRequest(BaseModel):
    challenge_token: str
    code: str
    remember_me: bool = False
