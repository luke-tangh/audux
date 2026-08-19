import multiprocessing
import os
import socket
import threading
import time
import urllib.request
import webbrowser
from contextlib import suppress

import uvicorn

from app.browser_lite import create_browser_lite_app


BROWSER_PORT_ENV = "AUDUX_BROWSER_PORT"
BROWSER_OPEN_ENV = "AUDUX_BROWSER_OPEN"


def _requested_port() -> int:
    raw = os.getenv(BROWSER_PORT_ENV, "").strip()
    if not raw:
        return 0
    try:
        port = int(raw)
    except ValueError as error:
        raise RuntimeError(f"{BROWSER_PORT_ENV} must be an integer") from error
    if not 1 <= port <= 65535:
        raise RuntimeError(f"{BROWSER_PORT_ENV} must be between 1 and 65535")
    return port


def _should_open_browser() -> bool:
    return os.getenv(BROWSER_OPEN_ENV, "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _open_browser_when_ready(url: str) -> None:
    health_url = f"{url}/health"
    for _ in range(100):
        try:
            with urllib.request.urlopen(health_url, timeout=1) as response:
                if response.status == 200:
                    if _should_open_browser():
                        opened = webbrowser.open(url, new=2)
                        if not opened:
                            print(f"Could not open a browser automatically. Open: {url}")
                    return
        except Exception:
            time.sleep(0.1)
    print(f"Backend did not become ready. Try opening: {url}")


def main() -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        listener.bind(("127.0.0.1", _requested_port()))
        listener.listen(2048)
    except Exception:
        listener.close()
        raise

    port = int(listener.getsockname()[1])
    url = f"http://127.0.0.1:{port}"
    print("Audux browser-lite")
    print(f"Open: {url}")
    print("Keep this terminal open. Press Ctrl+C to stop the application.")

    opener = threading.Thread(
        target=_open_browser_when_ready,
        args=(url,),
        name="browser-lite-opener",
        daemon=True,
    )
    opener.start()

    config = uvicorn.Config(
        create_browser_lite_app(),
        host="127.0.0.1",
        port=port,
        reload=False,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(config)
    server_errors: list[BaseException] = []

    def run_server() -> None:
        try:
            server.run(sockets=[listener])
        except BaseException as error:
            server_errors.append(error)

    server_thread = threading.Thread(
        target=run_server,
        name="browser-lite-server",
    )
    server_thread.start()

    try:
        while server_thread.is_alive():
            server_thread.join(timeout=0.5)
    except KeyboardInterrupt:
        print("\nStopping Audux...")
        server.should_exit = True
        server_thread.join(timeout=15)
    finally:
        with suppress(OSError):
            listener.close()

    if server_errors:
        raise server_errors[0]


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
