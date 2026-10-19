import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker-env.js';
import { rateLimitMiddleware } from './rate-limit.js';

afterEach(() => vi.useRealTimers());

describe('public referral burst budget', () => {
  it('blocks the 101st lookup before work, despite rotating refs, cookies and Bearer values; expires after one minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
    const lookup = vi.fn();
    const app = new Hono<Env>();
    app.use('*', rateLimitMiddleware);
    app.get('/r/*', c => { lookup(); return c.text('public landing'); });
    const request = (index: number, ip = '192.0.2.235') => app.request(`/r/example-${index}${index % 2 ? '/help' : ''}?vary=${index}`, {
      headers: { 'CF-Connecting-IP': ip, Authorization: `Bearer invalid-${index}`, Cookie: `lh_admin_session=invalid-${index}` },
    }, {} as Env['Bindings']);
    for (let i = 0; i < 100; i++) expect((await request(i)).status).toBe(200);
    const denied = await request(100);
    expect(denied.status).toBe(429);
    expect(denied.headers.get('Retry-After')).toBe('60');
    expect(lookup).toHaveBeenCalledTimes(100);
    expect((await request(101, '192.0.2.236')).status).toBe(200);
    vi.advanceTimersByTime(60_001);
    expect((await request(102)).status).toBe(200);
  });
});
