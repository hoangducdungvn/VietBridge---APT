"""Single-threaded FIFO worker for transcribe jobs.

The gateway pushes jobs ordered by server_received_at; this worker preserves
that order. Rule: once a FINAL job for an utterance_id enters the queue, any
still-queued PARTIAL jobs for the same utterance_id are dropped (a partial
already being processed is not interrupted).
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

from stt_service import service

logger = logging.getLogger("stt_service.queue_worker")


@dataclass
class STTJob:
    utterance_id: str
    audio: np.ndarray
    language_hint: str
    is_final: bool
    continuation_id: Optional[str] = None
    # Called with the transcribe() result dict, on the worker thread.
    callback: Optional[Callable[[dict], None]] = field(default=None, repr=False)


class STTQueueWorker:
    def __init__(self, transcribe_fn: Callable[..., dict] = service.transcribe):
        self._transcribe = transcribe_fn
        self._pending: deque[STTJob] = deque()
        self._cv = threading.Condition()
        self._closed = False
        self._thread = threading.Thread(target=self._run, name="stt-worker", daemon=True)
        self._thread.start()

    def submit(self, job: STTJob) -> None:
        with self._cv:
            if self._closed:
                raise RuntimeError("worker is closed")
            if job.is_final:
                before = len(self._pending)
                self._pending = deque(
                    j for j in self._pending
                    if j.is_final or j.utterance_id != job.utterance_id
                )
                dropped = before - len(self._pending)
                if dropped:
                    logger.info(
                        "utt=%s: dropped %d queued partial(s), final supersedes",
                        job.utterance_id, dropped,
                    )
            self._pending.append(job)
            self._cv.notify()

    def close(self, wait: bool = True) -> None:
        """Stop accepting jobs; drain what's queued, then exit the thread."""
        with self._cv:
            self._closed = True
            self._cv.notify()
        if wait:
            self._thread.join()

    def _run(self) -> None:
        while True:
            with self._cv:
                while not self._pending and not self._closed:
                    self._cv.wait()
                if not self._pending and self._closed:
                    return
                job = self._pending.popleft()
            try:
                result = self._transcribe(
                    utterance_id=job.utterance_id,
                    audio=job.audio,
                    language_hint=job.language_hint,
                    is_final=job.is_final,
                    continuation_id=job.continuation_id,
                )
            except Exception:
                # transcribe() already converts EngineError to a result dict;
                # anything reaching here is a bug — log it, keep the worker alive.
                logger.exception("utt=%s: unexpected error in transcribe", job.utterance_id)
                result = {
                    "utterance_id": job.utterance_id,
                    "type": "final" if job.is_final else "partial",
                    "text": "",
                    "language": job.language_hint,
                    "asr_latency_ms": 0.0,
                    "low_confidence": True,
                    "error": {"code": "internal", "message": "unexpected worker error", "status": None},
                }
                if job.continuation_id is not None:
                    result["continuation_id"] = job.continuation_id
            if job.callback is not None:
                try:
                    job.callback(result)
                except Exception:
                    logger.exception("utt=%s: callback raised", job.utterance_id)
