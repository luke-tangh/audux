import sys
from pathlib import Path

from starlette.staticfiles import StaticFiles

from .main import app as api_app


BUNDLED_FRONTEND_DIR = "browser_frontend"


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
        if (
            scope["type"] == "http"
            and self._is_static_request(
                str(scope.get("path") or "/"),
                str(scope.get("method") or "GET").upper(),
            )
        ):
            await self.static_app(scope, receive, send)
            return

        await api_app(scope, receive, send)


def create_browser_lite_app() -> BrowserLiteApplication:
    return BrowserLiteApplication()
