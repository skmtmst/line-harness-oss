export type { ServerTiming } from './server-timing-types.js';
import type { ServerTiming } from './server-timing-types.js';
import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../worker-env.js';
import { resolveCorsOrigin } from '../middleware/admin-auth-config.js';

function read(c: Context<Env>): ServerTiming | undefined {
  return c.get('serverTiming');
}

export function timingStart(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const now = Date.now();
    c.set('serverTiming', { last: now, start: now, parts: [] });
    await next();
    const timing = read(c);
    if (!timing || !c.get('staff')) return;
    const end = Date.now();
    const parts = [...timing.parts, { name: 'handler', dur: end - timing.last }, { name: 'total', dur: end - timing.start }];
    try {
      c.res.headers.append('Server-Timing', parts.map((part) => `${part.name};dur=${part.dur}`).join(', '));
      const requested = c.req.header('Origin');
      const origin = requested ? resolveCorsOrigin(c.env, requested, c.req.url) : '';
      if (origin) c.res.headers.set('Timing-Allow-Origin', origin);
    } catch {
      // 外から取った応答をそのまま返す口などは、ヘッダが書き換えられない。
      // 計測は付けられないだけで、応答そのものは返す（ここで500にしない）。
    }
  };
}

/** ここまでの段を name として記録する。 */
export function timingMark(name: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const timing = read(c);
    if (timing) {
      const now = Date.now();
      timing.parts.push({ name, dur: now - timing.last });
      timing.last = now;
    }
    await next();
  };
}
