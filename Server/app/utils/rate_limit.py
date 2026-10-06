"""Small in-memory sliding-window rate limiter for public endpoints (per process, resets on restart)."""
import threading
import time
from typing import Dict, List

_hits: Dict[str, List[float]] = {}
_lock = threading.Lock()
_last_prune = [0.0]


def allow(key: str, limit: int, window_seconds: float) -> bool:
    """Record one hit for `key` and return False when it has already had `limit` hits inside the window."""
    now = time.monotonic()
    with _lock:
        if now - _last_prune[0] > 300:  # drop idle keys now and then so the table cannot grow forever
            _last_prune[0] = now
            for stale in [k for k, v in _hits.items() if not v or now - v[-1] > 3600]:
                _hits.pop(stale, None)
        recent = [t for t in _hits.get(key, []) if now - t < window_seconds]
        if len(recent) >= limit:
            _hits[key] = recent
            return False
        recent.append(now)
        _hits[key] = recent
        return True


def reset() -> None:
    with _lock:
        _hits.clear()
