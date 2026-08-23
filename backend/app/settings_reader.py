from sqlmodel import Session

from .models import Setting


def get_setting(
    session: Session,
    key: str,
    default: str | None = None,
) -> str | None:
    row = session.get(Setting, key)
    return row.value if row else default


def get_setting_int(session: Session, key: str, default: int) -> int:
    value = get_setting(session, key)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def get_setting_float(session: Session, key: str, default: float) -> float:
    value = get_setting(session, key)
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default
