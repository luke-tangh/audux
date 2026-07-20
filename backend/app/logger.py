import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .db import LOGS_DIR

LOG_FILE = LOGS_DIR / "app.log"


def setup_logging():
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(logging.INFO)

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

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    stream_handler.setLevel(logging.INFO)

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

    return "".join(content[-lines:])
