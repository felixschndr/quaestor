from datetime import datetime, timezone
from typing import Annotated

from pydantic import PlainSerializer


def _serialize_as_utc(value: datetime) -> str:
    # Attach the UTC tzinfo so the wire format carries an explicit `+00:00` offset and the frontend can convert it
    return value.replace(tzinfo=timezone.utc).isoformat()


UtcDatetime = Annotated[datetime, PlainSerializer(_serialize_as_utc, return_type=str, when_used="json")]
