"""Shared supervision and diagnostics for persistent in-process workers."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass

from .logger import get_logger
from .time_utils import utc_now_iso


logger = get_logger(__name__)


@dataclass
class WorkerState:
    running: bool = False
    failure_count: int = 0
    consecutive_failures: int = 0
    last_error: str | None = None
    last_failure_at: str | None = None


_states: dict[str, WorkerState] = {}
_states_lock = threading.RLock()


def _update_state(name: str, **changes: object) -> None:
    with _states_lock:
        state = _states.setdefault(name, WorkerState())
        for key, value in changes.items():
            setattr(state, key, value)


def worker_state_snapshot() -> dict[str, dict[str, object]]:
    with _states_lock:
        return {name: asdict(state) for name, state in _states.items()}


async def run_supervised_loop(
    name: str,
    iteration: Callable[[], Awaitable[None]],
    *,
    poll_interval: float,
    failure_backoff: float = 1.0,
) -> None:
    """Run one worker iteration at a time and survive ordinary failures."""
    _update_state(name, running=True)
    try:
        while True:
            await asyncio.sleep(poll_interval)
            try:
                await iteration()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                with _states_lock:
                    state = _states.setdefault(name, WorkerState())
                    state.failure_count += 1
                    state.consecutive_failures += 1
                    state.last_error = str(error)
                    state.last_failure_at = utc_now_iso()
                logger.exception("Worker iteration failed name=%s; retrying", name)
                await asyncio.sleep(failure_backoff)
            else:
                _update_state(name, consecutive_failures=0)
    finally:
        _update_state(name, running=False)
