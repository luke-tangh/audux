import multiprocessing
import os
import sys

import uvicorn


DEFAULT_API_PORT = 8765
API_PORT_ENV = "AUDUX_API_PORT"


def _api_port_from_env() -> int:
    raw = os.getenv(API_PORT_ENV, "").strip()

    if not raw:
        return DEFAULT_API_PORT

    try:
        port = int(raw)
    except Exception:
        return DEFAULT_API_PORT

    if 1 <= port <= 65535:
        return port

    return DEFAULT_API_PORT


def main():
    if "--mcp" in sys.argv[1:]:
        from app.mcp_server import serve_stdio

        serve_stdio()
        return
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=_api_port_from_env(),
        reload=False,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
