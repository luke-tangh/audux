import asyncio

from app.request_limits import RequestBodyLimitMiddleware


def test_request_body_limit_rejects_declared_oversized_body():
    called = False
    messages = []

    async def downstream(scope, receive, send):
        nonlocal called
        called = True

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/settings",
        "headers": [(b"content-length", b"6")],
    }
    asyncio.run(RequestBodyLimitMiddleware(downstream, max_bytes=5)(scope, receive, send))

    assert called is False
    assert messages[0]["status"] == 413


def test_request_body_limit_counts_streamed_chunks():
    messages = []
    chunks = iter(
        [
            {"type": "http.request", "body": b"123", "more_body": True},
            {"type": "http.request", "body": b"456", "more_body": False},
        ]
    )

    async def downstream(scope, receive, send):
        await receive()
        await receive()

    async def receive():
        return next(chunks)

    async def send(message):
        messages.append(message)

    scope = {"type": "http", "method": "POST", "path": "/settings", "headers": []}
    asyncio.run(RequestBodyLimitMiddleware(downstream, max_bytes=5)(scope, receive, send))

    assert messages[0]["status"] == 413
