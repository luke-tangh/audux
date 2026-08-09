from fastapi import HTTPException

from ..services.common import ServiceError


def raise_http(error: ServiceError):
    raise HTTPException(
        status_code=error.status_code, detail=error.structured_detail()
    ) from error


def service_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ServiceError as error:
        raise_http(error)
