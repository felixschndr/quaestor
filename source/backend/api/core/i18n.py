from pydantic import BaseModel

from source.backend.api.core.create_router import create_router
from source.backend.services.core import i18n_service

router = create_router()


class SupportedLanguages(BaseModel):
    languages: list[str]


@router.get("/languages", response_model=SupportedLanguages)
def list_languages() -> SupportedLanguages:
    return SupportedLanguages(languages=list(i18n_service.SUPPORTED_LANGUAGES))
