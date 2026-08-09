from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api_routes import router as api_router
from .logger import setup_logging, get_logger
from .scanner import recover_interrupted_scan_tasks
from .tasks import start_worker_once
from .version import APP_VERSION
from .services.backup_service import initialize_database_with_pending_restore
from .local_security import (
    ALLOW_ALL_CORS,
    LOCAL_ORIGIN_REGEX,
    LOCAL_CLIENT_HEADER_NAME,
    LOCAL_CLIENT_HEADER_VALUE,
    LOCAL_TOKEN_HEADER_NAME,
    LOCAL_TOKEN_QUERY_NAME,
    UNSAFE_METHODS,
    _get_or_create_local_api_token,
    _is_allowed_request_origin,
    _is_token_exempt_path,
    _request_has_valid_local_token,
)


setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database_with_pending_restore()
    _get_or_create_local_api_token()

    try:
        recover_interrupted_scan_tasks()
    except Exception:
        logger.exception("Failed to recover interrupted scan tasks")

    start_worker_once()
    logger.info("Local Audio Library backend started")
    yield


app = FastAPI(
    title="Local Audio Library API",
    version=APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if ALLOW_ALL_CORS else [],
    allow_origin_regex=None if ALLOW_ALL_CORS else LOCAL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if ALLOW_ALL_CORS:
    logger.warning(
        "LOCAL_AUDIO_LIBRARY_ALLOW_ALL_CORS is enabled. "
        "This is intended for development only."
    )


@app.middleware("http")
async def local_request_guard(request: Request, call_next):
    """
    本地 API 防护。

    - Origin 必须是本机 / Tauri，除非显式开启 ALLOW_ALL_CORS。
    - unsafe method 必须携带固定本地客户端 header，防普通 CSRF form。
    - 除 health/auth/docs 外，所有 API 需要本地 token。
    - 媒体、封面、导出等 GET 可用 query token，方便 <audio>/<img>/window.open。
    """
    if request.method.upper() != "OPTIONS":
        path = request.url.path

        origin = request.headers.get("origin")
        if origin and not _is_allowed_request_origin(origin):
            return JSONResponse(
                status_code=403,
                content={"detail": {"code": "security.forbidden_origin", "params": {}, "fallback": "Forbidden origin"}},
            )

        if path == "/auth/token":
            client_header = request.headers.get(LOCAL_CLIENT_HEADER_NAME)
            if client_header != LOCAL_CLIENT_HEADER_VALUE:
                return JSONResponse(
                    status_code=403,
                    content={"detail": {"code": "security.missing_client", "params": {}, "fallback": "Missing local client header"}},
                )

        if request.method.upper() in UNSAFE_METHODS:
            client_header = request.headers.get(LOCAL_CLIENT_HEADER_NAME)
            if client_header != LOCAL_CLIENT_HEADER_VALUE:
                return JSONResponse(
                    status_code=403,
                    content={"detail": {"code": "security.missing_client", "params": {}, "fallback": "Missing local client header"}},
                )

        if not _is_token_exempt_path(path):
            if not _request_has_valid_local_token(request):
                return JSONResponse(
                    status_code=401,
                    content={"detail": {"code": "security.invalid_token", "params": {}, "fallback": "Missing or invalid local API token"}},
                )

    return await call_next(request)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/auth/token")
def get_auth_token():
    return {
        "token": _get_or_create_local_api_token(),
        "header": LOCAL_TOKEN_HEADER_NAME,
        "query": LOCAL_TOKEN_QUERY_NAME,
    }


app.include_router(api_router)
