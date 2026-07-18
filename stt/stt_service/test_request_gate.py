from __future__ import annotations

import threading
import unittest

from stt_service.request_gate import SttRequestGate


class SttRequestGateTest(unittest.TestCase):
    def test_serializes_requests_at_default_capacity(self) -> None:
        gate = SttRequestGate(1)
        attempted = threading.Event()
        entered = threading.Event()

        def worker() -> None:
            attempted.set()
            with gate.acquire(is_final=False):
                entered.set()

        with gate.acquire(is_final=False):
            thread = threading.Thread(target=worker)
            thread.start()
            self.assertTrue(attempted.wait(timeout=1))
            self.assertFalse(entered.wait(timeout=0.05))

        self.assertTrue(entered.wait(timeout=1))
        thread.join(timeout=1)
        self.assertFalse(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
