from sqlmodel import Session, select

from ..models import Setting, now_iso


def list_settings(session: Session) -> list[Setting]:
    return session.exec(select(Setting)).all()


def upsert_setting(session: Session, key: str, value: str) -> Setting:
    row = session.get(Setting, key)

    if row:
        row.value = value
        row.updated_at = now_iso()
    else:
        row = Setting(key=key, value=value)

    session.add(row)
    session.commit()
    session.refresh(row)
    return row
