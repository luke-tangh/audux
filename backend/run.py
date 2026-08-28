import multiprocessing
import os
import socket
import sys
from contextlib import suppress
from pathlib import Path

import uvicorn


DEFAULT_API_PORT = 8765
API_PORT_ENV = "AUDUX_API_PORT"
API_PORT_FILE_ENV = "AUDUX_API_PORT_FILE"


def _api_port_from_env() -> int:
    raw = os.getenv(API_PORT_ENV, "").strip()

    if not raw:
        return DEFAULT_API_PORT

    try:
        port = int(raw)
    except Exception:
        return DEFAULT_API_PORT

    if 0 <= port <= 65535:
        return port

    return DEFAULT_API_PORT


def _bind_api_listener(port: int) -> socket.socket:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        listener.bind(("127.0.0.1", port))
        listener.listen(2048)
    except Exception:
        listener.close()
        raise
    return listener


def _publish_api_port(port: int) -> Path | None:
    raw_path = os.getenv(API_PORT_FILE_ENV, "").strip()
    if not raw_path:
        return None
    path = Path(raw_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(str(port), encoding="utf-8")
    with suppress(OSError):
        temporary.chmod(0o600)
    temporary.replace(path)
    return path


def main():
    if "--mcp" in sys.argv[1:]:
        from app.mcp_server import serve_stdio

        serve_stdio()
        return
    listener = _bind_api_listener(_api_port_from_env())
    port = int(listener.getsockname()[1])
    port_file = _publish_api_port(port)
    config = uvicorn.Config(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        reload=False,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(config)
    try:
        server.run(sockets=[listener])
    finally:
        with suppress(OSError):
            listener.close()
        if port_file is not None:
            with suppress(OSError):
                port_file.unlink()


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
