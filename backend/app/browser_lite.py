import sys
from pathlib import Path

from starlette.staticfiles import StaticFiles

from .main import app as api_app


BUNDLED_FRONTEND_DIR = "browser_frontend"
SECURITY_HEADERS = (
    (
        b"content-security-policy",
        b"default-src 'self'; connect-src 'self'; media-src 'self' blob:; "
        b"img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
        b"script-src 'self'; object-src 'none'; base-uri 'none'; "
        b"frame-ancestors 'none'",
    ),
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"x-frame-options", b"DENY"),
)


def add_security_headers(message: dict) -> dict:
    if message["type"] != "http.response.start":
        return message
    headers = list(message.get("headers", []))
    existing = {name.lower() for name, _ in headers}
    headers.extend(
        (name, value)
        for name, value in SECURITY_HEADERS
        if name not in existing
    )
    return {**message, "headers": headers}


def browser_frontend_dir() -> Path:
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        return Path(bundle_root) / BUNDLED_FRONTEND_DIR
    return Path(__file__).resolve().parents[2] / "frontend" / "dist"


class BrowserLiteApplication:
    """Serve packaged frontend files while preserving the existing API guard."""

    def __init__(self, static_dir: Path | None = None):
        self.static_dir = (static_dir or browser_frontend_dir()).resolve()
        if not (self.static_dir / "index.html").is_file():
            raise RuntimeError(
                f"Browser-lite frontend was not found: {self.static_dir / 'index.html'}"
            )
        self.static_app = StaticFiles(directory=self.static_dir, html=True)

    def _is_static_request(self, path: str, method: str) -> bool:
        if method not in {"GET", "HEAD"}:
            return False
        if path == "/":
            return True

        relative = path.lstrip("/")
        if not relative:
            return True

        candidate = (self.static_dir / relative).resolve()
        try:
            candidate.relative_to(self.static_dir)
        except ValueError:
            return False
        return candidate.is_file()

    async def __call__(self, scope, receive, send):
        async def send_with_security_headers(message):
            await send(add_security_headers(message))

        if (
            scope["type"] == "http"
            and self._is_static_request(
                str(scope.get("path") or "/"),
                str(scope.get("method") or "GET").upper(),
            )
        ):
            await self.static_app(scope, receive, send_with_security_headers)
            return

        await api_app(scope, receive, send_with_security_headers)


def create_browser_lite_app() -> BrowserLiteApplication:
    return BrowserLiteApplication()
