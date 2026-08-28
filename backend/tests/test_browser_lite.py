from pathlib import Path

# Redirect module-level application data before importing app.main.
from tests import api_test_support  # noqa: F401
from app.browser_lite import BrowserLiteApplication, add_security_headers
import run_browser_lite


def test_browser_lite_recognizes_only_real_static_files(tmp_path: Path):
    frontend = tmp_path / "frontend"
    assets = frontend / "assets"
    assets.mkdir(parents=True)
    (frontend / "index.html").write_text("<h1>browser-lite</h1>", encoding="utf-8")
    (assets / "app.js").write_text("console.log('ok')", encoding="utf-8")

    browser_app = BrowserLiteApplication(frontend)

    assert browser_app._is_static_request("/", "GET") is True
    assert browser_app._is_static_request("/assets/app.js", "GET") is True
    assert browser_app._is_static_request("/health", "GET") is False
    assert browser_app._is_static_request("/settings", "POST") is False
    assert browser_app._is_static_request("/missing.txt", "GET") is False
    assert browser_app._is_static_request("/../index.html", "GET") is False


def test_browser_lite_sets_browser_security_headers():
    message = add_security_headers(
        {"type": "http.response.start", "status": 200, "headers": []}
    )
    headers = dict(message["headers"])

    assert b"frame-ancestors 'none'" in headers[b"content-security-policy"]
    assert headers[b"x-content-type-options"] == b"nosniff"
    assert headers[b"referrer-policy"] == b"no-referrer"
    assert headers[b"x-frame-options"] == b"DENY"


def test_browser_lite_port_and_browser_environment(monkeypatch):
    monkeypatch.delenv(run_browser_lite.BROWSER_PORT_ENV, raising=False)
    monkeypatch.delenv(run_browser_lite.BROWSER_OPEN_ENV, raising=False)
    assert run_browser_lite._requested_port() == 0
    assert run_browser_lite._should_open_browser() is True

    monkeypatch.setenv(run_browser_lite.BROWSER_PORT_ENV, "9123")
    monkeypatch.setenv(run_browser_lite.BROWSER_OPEN_ENV, "false")
    assert run_browser_lite._requested_port() == 9123
    assert run_browser_lite._should_open_browser() is False
