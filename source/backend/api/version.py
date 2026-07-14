from pydantic import BaseModel

from source.backend.api.create_router import create_router
from source.backend.helpers import get_project_version
from source.backend.services import version_service

router = create_router()


class VersionInfo(BaseModel):
    current: str
    latest: str | None
    update_available: bool
    release_url: str | None


@router.get("", response_model=VersionInfo)
def get_version() -> VersionInfo:
    current = get_project_version()
    latest_release = version_service.get_latest_release()
    if latest_release is None:
        return VersionInfo(current=current, latest=None, update_available=False, release_url=None)

    latest, release_url = latest_release
    return VersionInfo(
        current=current,
        latest=latest,
        update_available=version_service.is_newer(current=current, latest=latest),
        release_url=release_url,
    )
