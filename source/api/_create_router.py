import inspect
import os

from fastapi import APIRouter


def create_router() -> APIRouter:
    caller = inspect.stack()[1]
    caller_filename = os.path.basename(caller.filename).replace(".py", "")
    return APIRouter(prefix=f"/{caller_filename}", tags=[caller_filename])
