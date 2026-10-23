export type { ServerTiming } from './server-timing-types.js';
import type { ServerTiming, TimingSpan, TimingStage } from './server-timing-types.js';
import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../worker-env.js';
import { resolveCorsOrigin } from '../middleware/admin-auth-config.js';
import { createD1Timing, timedD1 } from './d1-timing.js';

const timingsByDb = new WeakMap<D1Database, ServerTiming>();
const STAGES: TimingStage[] = ['cors', 'rate', 'auth', 'tenant', 'pii', 'audit', 'feature', 'sensitive'];
const SPANS: TimingSpan[] = ['session', 'staff', 'scope', 'impersonation', 'handler'];
const numeric = (value: number) => Number.isFinite(value) ? Math.max(0, value).toFixed(2) : '0.00';

function add(timing: ServerTiming | undefined, name: TimingStage | TimingSpan, duration: number): void {
  if (timing && !timing.d1.closed) timing.parts[name] = (timing.parts[name] ?? 0) + Math.max(0, duration);
}

export function timingStart(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const timing: ServerTiming = { start: Date.now(), parts: {}, d1: createD1Timing() };
    c.set('serverTiming', timing);
    // envとBindingを要求ごとに包む。共有envや他の同時要求の計測値は変更しない。
    if (c.env?.DB) {
      const db = timedD1(c.env.DB, timing.d1);
      timingsByDb.set(db, timing);
      c.env = { ...c.env, DB: db };
    }
    await next();
    timing.d1.closed = true;
    const parts = [...STAGES, ...SPANS].map(name => `${name};dur=${numeric(timing.parts[name] ?? 0)}`);
    parts.push(`total;dur=${numeric(Date.now() - timing.start)}`, `d1;dur=${numeric(timing.d1.duration)}`,
      `d1_count;desc="${timing.d1.count}"`, `d1_pending;desc="${timing.d1.pending}"`,
      `d1_sql_count;desc="${timing.d1.sqlCount}"`);
    if (timing.d1.sqlCount > 0) parts.push(`d1_sql;dur=${numeric(timing.d1.sqlDuration)}`);
    // fetchで受けたimmutableな応答は、本文を読み込まずヘッダだけ複製する。
    // WebSocketの101はWorkers固有なので、接続を保持したまま直接付ける。
    if (c.res.status !== 101) c.res = new Response(c.res.body, c.res);
    c.res.headers.set('Server-Timing', parts.join(', '));
    const requested = c.req.header('Origin');
    const origin = requested ? resolveCorsOrigin(c.env, requested, c.req.url) : '';
    if (origin) c.res.headers.set('Timing-Allow-Origin', origin);
    else c.res.headers.delete('Timing-Allow-Origin');
  };
}

/** nextより先の処理を差し引き、拒否・例外・応答加工も実行した段へ帰属させる。 */
export function timingMiddleware(name: TimingStage, middleware: MiddlewareHandler<Env>): MiddlewareHandler<Env> {
  return async (c, next) => {
    const started = Date.now();
    let downstream = 0;
    try {
      return await middleware(c, async () => {
        const before = Date.now();
        try { await next(); } finally { downstream += Date.now() - before; }
      });
    } finally { add(c.get?.('serverTiming'), name, Date.now() - started - downstream); }
  };
}

async function span<T>(timing: ServerTiming | undefined, name: TimingSpan, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try { return await work(); } finally { add(timing, name, Date.now() - started); }
}

export function timingSpan<T>(c: Context<Env>, name: TimingSpan, work: () => Promise<T>): Promise<T> {
  return span(c.get?.('serverTiming'), name, work);
}

export function timingDbSpan<T>(db: D1Database, name: TimingSpan, work: () => Promise<T>): Promise<T> {
  return span(timingsByDb.get(db), name, work);
}

export function timingHandler(): MiddlewareHandler<Env> {
  return (c, next) => timingSpan(c, 'handler', next);
}
