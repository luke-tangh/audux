import json

from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..models import LibraryRoot, SavedView, Tag, now_iso
from ..schemas import SavedViewQuery
from .common import ServiceError


def _normalize_name(name: str) -> str:
    normalized = " ".join(name.split())
    if not normalized:
        raise ServiceError(
            400,
            "Saved view name is required",
            "saved_view.name_required",
        )
    if len(normalized) > 80:
        raise ServiceError(
            400,
            "Saved view name is too long",
            "saved_view.name_too_long",
        )
    return normalized


def _get_view(session: Session, view_id: int) -> SavedView:
    row = session.get(SavedView, view_id)
    if not row:
        raise ServiceError(404, "Saved view not found", "saved_view.not_found")
    return row


def _ensure_name_available(
    session: Session,
    name: str,
    *,
    excluding_id: int | None = None,
) -> None:
    stmt = select(SavedView).where(func.lower(SavedView.name) == name.lower())
    if excluding_id is not None:
        stmt = stmt.where(SavedView.id != excluding_id)
    if session.exec(stmt).first():
        raise ServiceError(
            409,
            "Saved view name already exists",
            "saved_view.name_exists",
        )


def _encode_query(query: SavedViewQuery) -> str:
    return json.dumps(
        query.model_dump(),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _commit_name_change(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise ServiceError(
            409,
            "Saved view name already exists",
            "saved_view.name_exists",
        ) from error


def _serialize_view(session: Session, row: SavedView) -> dict:
    query: SavedViewQuery | None = None
    definition_error: str | None = None
    try:
        raw_query = json.loads(row.query_json)
        if not isinstance(raw_query, dict):
            raise ValueError("definition must be an object")
        if (
            raw_query.get("schema_version", row.schema_version) != 1
            or row.schema_version != 1
        ):
            raise ValueError("unsupported schema version")
        query = SavedViewQuery.model_validate(raw_query)
    except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as error:
        definition_error = str(error)

    tag_name: str | None = None
    library_root_path: str | None = None
    invalid_references: list[str] = []
    if query and query.tag_id is not None:
        tag = session.get(Tag, query.tag_id)
        if tag:
            tag_name = tag.name
        else:
            invalid_references.append("tag")
    if query and query.library_root_id is not None:
        root = session.get(LibraryRoot, query.library_root_id)
        if root:
            library_root_path = root.path
        else:
            invalid_references.append("library_root")

    return {
        **row.model_dump(exclude={"query_json"}),
        "query": query.model_dump() if query else None,
        "tag_name": tag_name,
        "library_root_path": library_root_path,
        "invalid_references": invalid_references,
        "definition_error": definition_error,
    }


def list_saved_views(session: Session) -> list[dict]:
    rows = session.exec(
        select(SavedView).order_by(SavedView.sort_order, SavedView.id)
    ).all()
    return [_serialize_view(session, row) for row in rows]


def create_saved_view(
    session: Session,
    name: str,
    query: SavedViewQuery,
) -> dict:
    normalized_name = _normalize_name(name)
    _ensure_name_available(session, normalized_name)
    max_order = session.exec(select(func.max(SavedView.sort_order))).one()
    row = SavedView(
        name=normalized_name,
        query_json=_encode_query(query),
        schema_version=query.schema_version,
        sort_order=0 if max_order is None else max_order + 1,
    )
    session.add(row)
    _commit_name_change(session)
    session.refresh(row)
    return _serialize_view(session, row)


def update_saved_view(
    session: Session,
    view_id: int,
    *,
    name: str | None = None,
    query: SavedViewQuery | None = None,
) -> dict:
    row = _get_view(session, view_id)
    if name is not None:
        normalized_name = _normalize_name(name)
        _ensure_name_available(session, normalized_name, excluding_id=view_id)
        row.name = normalized_name
    if query is not None:
        row.query_json = _encode_query(query)
        row.schema_version = query.schema_version
    row.updated_at = now_iso()
    session.add(row)
    _commit_name_change(session)
    session.refresh(row)
    return _serialize_view(session, row)


def _default_copy_name(session: Session, source_name: str) -> str:
    suffix = " 副本"
    base = f"{source_name[:80 - len(suffix)]}{suffix}"
    candidate = base
    index = 2
    while session.exec(
        select(SavedView.id).where(func.lower(SavedView.name) == candidate.lower())
    ).first() is not None:
        numbered_suffix = f" {index}"
        candidate = f"{base[:80 - len(numbered_suffix)]}{numbered_suffix}"
        index += 1
    return candidate


def copy_saved_view(
    session: Session,
    view_id: int,
    name: str | None = None,
) -> dict:
    source = _get_view(session, view_id)
    normalized_name = (
        _normalize_name(name)
        if name is not None
        else _default_copy_name(session, source.name)
    )
    _ensure_name_available(session, normalized_name)
    max_order = session.exec(select(func.max(SavedView.sort_order))).one()
    row = SavedView(
        name=normalized_name,
        query_json=source.query_json,
        schema_version=source.schema_version,
        sort_order=0 if max_order is None else max_order + 1,
    )
    session.add(row)
    _commit_name_change(session)
    session.refresh(row)
    return _serialize_view(session, row)


def reorder_saved_views(session: Session, view_ids: list[int]) -> list[dict]:
    if len(view_ids) != len(set(view_ids)):
        raise ServiceError(
            400,
            "Duplicate saved view ids",
            "saved_view.duplicate_ids",
        )
    rows = session.exec(select(SavedView)).all()
    rows_by_id = {row.id: row for row in rows}
    if set(view_ids) != set(rows_by_id):
        raise ServiceError(
            400,
            "view_ids must exactly match current saved views",
            "saved_view.items_mismatch",
        )
    timestamp = now_iso()
    for sort_order, view_id in enumerate(view_ids):
        row = rows_by_id[view_id]
        row.sort_order = sort_order
        row.updated_at = timestamp
        session.add(row)
    session.commit()
    return list_saved_views(session)


def delete_saved_view(session: Session, view_id: int) -> dict:
    row = _get_view(session, view_id)
    session.delete(row)
    session.commit()
    return {"ok": True}
