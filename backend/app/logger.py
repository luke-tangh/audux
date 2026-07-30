import logging
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from .db import LOGS_DIR

LOG_FILE = LOGS_DIR / "app.log"

SENSITIVE_PATTERNS = [
    # URLs: ?access_token=xxx or &access_token=xxx
    re.compile(r"([?&]access_token=)[^&\s]+", re.IGNORECASE),
    # Headers, if they ever appear in logs
    re.compile(r"(X-Local-Audio-Token:\s*)[^\s,;]+", re.IGNORECASE),
    re.compile(r"(Authorization:\s*Bearer\s+)[^\s,;]+", re.IGNORECASE),
]


def redact_sensitive_text(value: str) -> str:
    redacted = value

    for pattern in SENSITIVE_PATTERNS:
        redacted = pattern.sub(r"\1[redacted]", redacted)

    return redacted


def _redact_log_arg(value: Any) -> Any:
    if isinstance(value, str):
        return redact_sensitive_text(value)

    # Third-party loggers may pass URL objects instead of strings. Preserve
    # numeric and structured arguments unless rendering reveals a sensitive
    # value, in which case returning a redacted string remains safe for %s.
    try:
        rendered = str(value)
        redacted = redact_sensitive_text(rendered)
        if redacted != rendered:
            return redacted
    except Exception:
        pass

    return value


class SensitiveDataFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, str):
                record.msg = redact_sensitive_text(record.msg)

            if isinstance(record.args, tuple):
                record.args = tuple(_redact_log_arg(arg) for arg in record.args)
            elif isinstance(record.args, dict):
                record.args = {
                    key: _redact_log_arg(value)
                    for key, value in record.args.items()
                }

        except Exception:
            # Logging filters must never break the application.
            pass

        return True


def _handler_has_sensitive_filter(handler: logging.Handler) -> bool:
    return any(
        isinstance(filter_obj, SensitiveDataFilter)
        for filter_obj in handler.filters
    )


def _add_sensitive_filter_once(
    handler: logging.Handler,
    sensitive_filter: SensitiveDataFilter,
):
    if not _handler_has_sensitive_filter(handler):
        handler.addFilter(sensitive_filter)


def _install_sensitive_filter_on_existing_handlers(
    sensitive_filter: SensitiveDataFilter,
):
    # Uvicorn may install handlers on these loggers before FastAPI imports
    # app.main and calls setup_logging(). Attach the same redaction filter to
    # them so access_token / Authorization values are not printed to sidecar
    # stdout/stderr or inherited logs.
    for logger_name in ["", "uvicorn", "uvicorn.error", "uvicorn.access"]:
        target_logger = logging.getLogger(logger_name)
        for handler in target_logger.handlers:
            _add_sensitive_filter_once(handler, sensitive_filter)


def setup_logging():
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    sensitive_filter = SensitiveDataFilter()
    _install_sensitive_filter_on_existing_handlers(sensitive_filter)

    exists = any(
        isinstance(handler, RotatingFileHandler)
        and getattr(handler, "baseFilename", None) == str(LOG_FILE)
        for handler in root.handlers
    )

    if exists:
        return

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )

    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=2 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.INFO)
    file_handler.addFilter(sensitive_filter)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    stream_handler.setLevel(logging.INFO)
    stream_handler.addFilter(sensitive_filter)

    root.addHandler(file_handler)
    root.addHandler(stream_handler)


def get_logger(name: str):
    return logging.getLogger(name)


def read_log_tail(lines: int = 300) -> str:
    path = Path(LOG_FILE)
    if not path.exists():
        return ""

    lines = max(1, min(lines, 2000))

    with path.open("r", encoding="utf-8", errors="ignore") as f:
        content = f.readlines()

    return redact_sensitive_text("".join(content[-lines:]))


def read_log_file_redacted(max_bytes: int = 10 * 1024 * 1024) -> str:
    path = Path(LOG_FILE)
    if not path.exists():
        return ""

    max_bytes = max(1, min(max_bytes, 20 * 1024 * 1024))

    with path.open("rb") as f:
        data = f.read(max_bytes + 1)

    text = data[:max_bytes].decode("utf-8", errors="ignore")

    return redact_sensitive_text(text)
