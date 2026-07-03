"""In-process TTL cache with stale reads for serve-stale-on-failure."""

import time
from typing import Callable


class TTLCache:
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._store: dict[str, tuple[float, object]] = {}

    def put(self, key: str, value: object) -> None:
        self._store[key] = (self._clock(), value)

    def get(self, key: str, ttl_seconds: float) -> object | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        ts, value = entry
        return value if self._clock() - ts < ttl_seconds else None

    def get_stale(self, key: str) -> tuple[object, int] | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        ts, value = entry
        return value, int(self._clock() - ts)
