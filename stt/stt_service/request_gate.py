"""Thread-safe upstream STT concurrency gate with final-request priority."""

from __future__ import annotations

from contextlib import contextmanager
import threading
from typing import Iterator


class SttRequestGate:
    def __init__(self, max_concurrent: int) -> None:
        self._max_concurrent = max(1, max_concurrent)
        self._condition = threading.Condition()
        self._active = 0
        self._waiting_finals = 0

    @contextmanager
    def acquire(self, is_final: bool) -> Iterator[None]:
        with self._condition:
            if is_final:
                self._waiting_finals += 1
            try:
                self._condition.wait_for(
                    lambda: self._active < self._max_concurrent
                    and (is_final or self._waiting_finals == 0)
                )
                self._active += 1
            finally:
                if is_final:
                    self._waiting_finals -= 1

        try:
            yield
        finally:
            with self._condition:
                self._active -= 1
                self._condition.notify_all()
