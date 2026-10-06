"""Pilot worker scheduler; uses the installed platform's unchanged message handlers."""
import asyncio
import logging
import os
import time


async def run(pool, heartbeat, outbound, inbound, *, sleep=asyncio.sleep,
              clock=time.monotonic, idle_seconds=0.25):
    if not 0.1 <= idle_seconds <= 2:
        raise ValueError('Idle interval must be between 0.1 and 2 seconds')
    next_health = 0
    while True:
        try:
            now = clock()
            if now >= next_health:
                await heartbeat(pool)
                next_health = now + 10
            await outbound(pool)
            if await inbound(pool):
                continue
        except Exception:
            # Retain the original outage backoff; never replay uncertain dispatches.
            logging.getLogger(__name__).warning('WhatsApp worker cycle unavailable')
            await sleep(2)
            continue
        await sleep(idle_seconds)


async def main():
    from psycopg.rows import dict_row
    from psycopg_pool import AsyncConnectionPool
    from agent_platform.whatsapp_worker import heartbeat, tick
    from agent_platform.whatsapp_outbound import tick_outbound
    async with AsyncConnectionPool(
        os.environ['AI_PLATFORM_DATABASE_URL'], min_size=1, max_size=4,
        kwargs={'row_factory': dict_row}, open=False,
    ) as pool:
        await run(pool, heartbeat, tick_outbound, tick)


if __name__ == '__main__':
    asyncio.run(main())
