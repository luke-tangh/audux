from datetime import UTC, datetime, timedelta

from sqlmodel import Session

from ..time_utils import utc_now_iso
from .statistics_queries import (
    distribution_statistics,
    ingest_timeline,
    library_statistics,
    listening_statistics,
)


def get_statistics_overview(session: Session, days: int = 30) -> dict:
    period_start = (datetime.now(UTC) - timedelta(days=days - 1)).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
        tzinfo=None,
    ).isoformat()
    library, coverage = library_statistics(session)
    distributions = distribution_statistics(session)
    return {
        "generated_at": utc_now_iso(),
        "period_days": days,
        "period_started_at": period_start,
        "library": library,
        "coverage": coverage,
        **distributions,
        "ingest_timeline": ingest_timeline(session),
        "listening": listening_statistics(session, period_start),
    }
