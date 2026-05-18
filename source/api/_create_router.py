import inspect
import os

from fastapi import APIRouter


def create_router() -> APIRouter:
    caller = inspect.stack()[1]
    caller_filename = os.path.basename(caller.filename).replace(".py", "")
    tags = caller_filename.replace("_", " ").title()
    return APIRouter(prefix=f"/{caller_filename}", tags=[tags])
