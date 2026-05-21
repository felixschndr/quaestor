from pydantic import BaseModel
from source.backend.api.create_router import create_router
from source.backend.services import i18n_service

router = create_router()


class SupportedLanguages(BaseModel):
    languages: list[str]


@router.get("/languages", response_model=SupportedLanguages)
def list_languages() -> SupportedLanguages:
    return SupportedLanguages(languages=i18n_service.list_supported_languages())
