import hmac
import ipaddress
import os
import re
import secrets
from typing import Optional
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from sqlmodel import Session

from .db import APP_DATA_DIR
from .logger import get_logger
from .models import Setting


logger = get_logger(__name__)

ALLOW_ALL_CORS = os.getenv("LOCAL_AUDIO_LIBRARY_ALLOW_ALL_CORS", "").lower() in {
    "1",
    "true",
    "yes",
}

LOCAL_ORIGIN_REGEX = (
    r"^(https?://(127\.0\.0\.1|localhost)(:\d+)?"
    r"|https?://tauri\.localhost"
    r"|tauri://localhost)$"
)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

LOCAL_CLIENT_HEADER_NAME = "X-Local-Audio-Client"
LOCAL_CLIENT_HEADER_VALUE = "local-audio-library"

LOCAL_TOKEN_HEADER_NAME = "X-Local-Audio-Token"
LOCAL_TOKEN_QUERY_NAME = "access_token"
LOCAL_TOKEN_FILE = APP_DATA_DIR / "local_api_token"

PUBLIC_PATHS = {
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
}

TOKEN_EXEMPT_PATHS = PUBLIC_PATHS | {
    "/auth/token",
}

QUERY_TOKEN_EXACT_PATHS = {
    "/export/metadata",
    "/logs/app/file",
}

QUERY_TOKEN_PATH_PATTERNS = (
    re.compile(r"^/audio-items/\d+/(?:file|cover)$"),
    re.compile(r"^/audio-items/\d+/transcript/export$"),
    re.compile(r"^/playlists/\d+/export$"),
)


def _get_or_create_local_api_token() -> str:
    """
    本地 API token。

    目标：
    - 防止任意网页仅靠 no-cors/form 触发敏感 API。
    - GET 媒体/导出接口可通过 query token 使用，方便 audio/img/window.open。
    - 不是系统级认证，无法防同机恶意进程读取本地 API。
    """
    try:
        if LOCAL_TOKEN_FILE.exists():
            token = LOCAL_TOKEN_FILE.read_text(encoding="utf-8").strip()
            if token:
                return token
    except Exception:
        logger.exception("Failed to read local API token")

    token = secrets.token_urlsafe(32)

    try:
        LOCAL_TOKEN_FILE.write_text(token, encoding="utf-8")
        try:
            os.chmod(LOCAL_TOKEN_FILE, 0o600)
        except Exception:
            pass
    except Exception:
        logger.exception("Failed to write local API token")

    return token


def _is_public_path(path: str) -> bool:
    if path in PUBLIC_PATHS:
        return True

    return path.startswith("/docs/") or path.startswith("/redoc/")


def _is_token_exempt_path(path: str) -> bool:
    if path in TOKEN_EXEMPT_PATHS:
        return True

    return path.startswith("/docs/") or path.startswith("/redoc/")


def _path_allows_query_token(path: str) -> bool:
    if path in QUERY_TOKEN_EXACT_PATHS:
        return True

    return any(pattern.fullmatch(path) for pattern in QUERY_TOKEN_PATH_PATTERNS)


def _request_has_valid_local_token(request: Request) -> bool:
    expected = _get_or_create_local_api_token()

    provided = request.headers.get(LOCAL_TOKEN_HEADER_NAME)
    if not provided and _path_allows_query_token(request.url.path):
        provided = request.query_params.get(LOCAL_TOKEN_QUERY_NAME)

    if not provided:
        return False

    return hmac.compare_digest(provided, expected)


def _is_allowed_request_origin(origin: str) -> bool:
    if ALLOW_ALL_CORS:
        return True

    try:
        parsed = urlparse(origin)
        scheme = (parsed.scheme or "").lower()
        host = (parsed.hostname or "").lower()

        if scheme == "tauri" and host == "localhost":
            return True

        if scheme not in {"http", "https"}:
            return False

        if host in {"localhost", "127.0.0.1", "::1"}:
            return True

        if host.endswith(".localhost"):
            return True

        try:
            ip = ipaddress.ip_address(host)
            return bool(ip.is_loopback)
        except Exception:
            return False

    except Exception:
        return False


def _is_local_endpoint(endpoint: str) -> bool:
    try:
        parsed = urlparse(endpoint)
        host = parsed.hostname
        if not host:
            return False

        host = host.lower()

        if host in {"localhost", "127.0.0.1", "::1"}:
            return True

        if host.endswith(".localhost"):
            return True

        try:
            ip = ipaddress.ip_address(host)
            return bool(ip.is_loopback)
        except Exception:
            return False

    except Exception:
        return False


def _llm_privacy_warning(endpoint: str) -> Optional[str]:
    if not endpoint:
        return None

    if _is_local_endpoint(endpoint):
        return None

    return (
        "当前 LLM endpoint 不是 localhost / 127.0.0.1。"
        "AI 分析会把音频元数据和转写文本发送到该地址。"
        "请确认这是你信任的本地或内网模型服务。"
    )


def _asr_privacy_warning(endpoint: str) -> Optional[str]:
    if not endpoint:
        return None

    if _is_local_endpoint(endpoint):
        return None

    return (
        "当前 ASR endpoint 不是 localhost / 127.0.0.1。"
        "转写会把完整音频文件发送到该地址。"
        "请确认这是你信任的本地或内网模型服务。"
    )


def _setting_truthy(value: Optional[str]) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def ensure_llm_endpoint_allowed(session: Session, endpoint: str) -> Optional[str]:
    """
    Remote LLM endpoints are privacy-sensitive because metadata and transcript
    are sent to them. The UI exposes this as an explicit opt-in setting.
    """
    warning = _llm_privacy_warning(endpoint)
    if not warning:
        return None

    allow_remote = session.get(Setting, "llm.allow_remote_endpoint")
    if not allow_remote or not _setting_truthy(allow_remote.value):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "security.remote_llm_not_allowed",
                "params": {},
                "fallback": "The non-local LLM endpoint has not been explicitly allowed.",
            },
        )

    return warning


def ensure_asr_endpoint_allowed(session: Session, endpoint: str) -> Optional[str]:
    """
    External ASR endpoints receive the source audio, so remote use requires a
    separate explicit opt-in from the LLM endpoint setting.
    """
    warning = _asr_privacy_warning(endpoint)
    if not warning:
        return None

    allow_remote = session.get(Setting, "asr.external.allow_remote_endpoint")
    if not allow_remote or not _setting_truthy(allow_remote.value):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "security.remote_asr_not_allowed",
                "params": {},
                "fallback": "The non-local ASR endpoint has not been explicitly allowed.",
            },
        )

    return warning
