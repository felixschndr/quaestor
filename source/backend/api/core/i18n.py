from pydantic import BaseModel

from source.backend.api.core.create_router import create_router
from source.backend.services.core import i18n_service

router = create_router()


class SupportedLanguages(BaseModel):
    languages: list[str]


class SupportedCurrencies(BaseModel):
    currencies: list[str]


@router.get("/languages", response_model=SupportedLanguages)
def list_languages() -> SupportedLanguages:
    return SupportedLanguages(languages=list(i18n_service.SUPPORTED_LANGUAGES))


@router.get("/currencies", response_model=SupportedCurrencies)
def list_currencies() -> SupportedCurrencies:
    return SupportedCurrencies(currencies=list(i18n_service.SUPPORTED_CURRENCIES))
