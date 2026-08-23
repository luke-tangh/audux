import re
from urllib.parse import quote


SAFE_DOWNLOAD_NAME_PATTERN = re.compile(r'[\r\n\\/"<>|:*?]+')


def safe_download_name(name: str) -> str:
    safe = SAFE_DOWNLOAD_NAME_PATTERN.sub("_", name).strip()
    return (safe or "download")[:180]


def attachment_headers(filename: str) -> dict:
    filename = safe_download_name(filename)
    return {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
    }


def srt_time(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    ms = total_ms % 1000
    total = total_ms // 1000
    s = total % 60
    m = (total // 60) % 60
    h = total // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
