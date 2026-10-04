import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import type { LiveEvent } from '@sahayak/shared';

export type Envelope = { clinicId: string; event: LiveEvent };

/**
 * Fan-out of live events to connected screens. Uses Redis pub/sub when REDIS_URL is set and
 * reachable (so several API instances stay in sync); otherwise falls back to in-process delivery.
 */
export class EventBus {
  private local = new EventEmitter();
  private pub?: Redis;
  private redisOk = false;
  private static CHANNEL = 'sahayak:events';

  constructor(redisUrl = process.env.REDIS_URL) {
    this.local.setMaxListeners(0);
    if (!redisUrl) return;
    const opts = { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null };
    const pub = new Redis(redisUrl, opts);
    const sub = new Redis(redisUrl, opts);
    pub.on('error', () => { this.redisOk = false; });
    sub.on('error', () => { this.redisOk = false; });
    Promise.all([pub.connect(), sub.connect()])
      .then(async () => {
        await sub.subscribe(EventBus.CHANNEL);
        sub.on('message', (_c, raw) => this.local.emit('event', JSON.parse(raw) as Envelope));
        this.pub = pub;
        this.redisOk = true;
      })
      .catch(() => { this.redisOk = false; });
  }

  publish(clinicId: string, event: LiveEvent) {
    const env: Envelope = { clinicId, event };
    if (this.pub && this.redisOk) this.pub.publish(EventBus.CHANNEL, JSON.stringify(env)).catch(() => this.local.emit('event', env));
    else this.local.emit('event', env);
  }

  subscribe(clinicId: string, fn: (e: LiveEvent) => void): () => void {
    const h = (env: Envelope) => { if (env.clinicId === clinicId) fn(env.event); };
    this.local.on('event', h);
    return () => this.local.off('event', h);
  }

  async close() { await Promise.allSettled([this.pub?.quit()]); }
}
