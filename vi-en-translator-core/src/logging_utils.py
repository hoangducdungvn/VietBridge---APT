"""Cấu hình log và đo latency thống nhất."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Iterator


def configure_logging(level: str = "INFO") -> None:
    """Khởi tạo logging cho ứng dụng nếu chưa được cấu hình."""
    logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@contextmanager
def latency_timer(metrics: dict[str, float], name: str) -> Iterator[None]:
    """Ghi thời gian chạy theo millisecond vào mapping metrics."""
    started = time.perf_counter()
    try:
        yield
    finally:
        metrics[name] = round((time.perf_counter() - started) * 1000, 2)
