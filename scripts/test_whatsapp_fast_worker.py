import asyncio
import unittest
from unittest.mock import AsyncMock
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('fast_worker', Path(__file__).with_name('whatsapp-fast-worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class SchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def test_idle_pickup_and_heartbeat_throttle(self):
        heartbeat, outbound = AsyncMock(), AsyncMock()
        inbound = AsyncMock(return_value=False)
        waits = []
        async def sleep(seconds):
            waits.append(seconds)
            if len(waits) == 3:
                raise asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await worker.run(None, heartbeat, outbound, inbound, sleep=sleep, clock=lambda: 1)
        self.assertEqual(waits, [0.25, 0.25, 0.25])
        self.assertEqual(heartbeat.await_count, 1)
        self.assertEqual(inbound.await_count, 3)

    async def test_ready_work_has_no_poll_delay(self):
        inbound = AsyncMock(side_effect=[True, asyncio.CancelledError()])
        sleep = AsyncMock()
        with self.assertRaises(asyncio.CancelledError):
            await worker.run(None, AsyncMock(), AsyncMock(), inbound, sleep=sleep)
        sleep.assert_not_awaited()

    async def test_failure_retains_backoff(self):
        sleep = AsyncMock(side_effect=asyncio.CancelledError())
        with self.assertRaises(asyncio.CancelledError):
            await worker.run(None, AsyncMock(), AsyncMock(),
                             AsyncMock(side_effect=RuntimeError()), sleep=sleep)
        sleep.assert_awaited_once_with(2)


if __name__ == '__main__':
    unittest.main()
