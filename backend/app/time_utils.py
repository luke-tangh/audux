from datetime import UTC, datetime


def utc_now_iso() -> str:
    """Return UTC in the naive ISO format used by existing database rows."""
    return datetime.now(UTC).replace(tzinfo=None).isoformat()


def utc_timestamp_iso(timestamp: float) -> str:
    """Convert a POSIX timestamp to the database's naive UTC ISO format."""
    return datetime.fromtimestamp(timestamp, UTC).replace(tzinfo=None).isoformat()
