/*
 * R429: 公開受信の頻度制限は、不正な認証ヘッダーを付けても緩まない。
 *
 * 落ち方（直前）: 同一IPが上限（100/分）に達した後、存在しない Bearer 値を
 *   付けるだけで認証済み枠（1000/分）へ切り替わり、429 が 401 に戻る。
 * 通り方（直後）: 受信口は公開口として IP 枠で抑え、Authorization の
 *   有無・内容によらず上限を緩めない。
 */
import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { rateLimitMiddleware } from './rate-limit.js';
import type { Env } from '../index.js';

function app() {
  const a = new Hono<Env>();
  a.use('*', rateLimitMiddleware);
  a.post('/api/webhooks/incoming/:id/receive', (c) => c.json({ success: true }));
  return a;
}

const env = {} as Env['Bindings'];

describe('R429 公開受信の制限は認証ヘッダーで緩まない', () => {
  test('上限到達後は不正Bearer・不正Cookieを付けても429のまま', async () => {
    const a = app();
    const ip = '203.0.113.91';
    for (let i = 0; i < 100; i++) {
      const res = await a.request('/api/webhooks/incoming/wh-1/receive', {
        method: 'POST',
        headers: { 'cf-connecting-ip': ip },
      }, env);
      expect(res.status).toBe(200);
    }
    const limited = await a.request('/api/webhooks/incoming/wh-1/receive', {
      method: 'POST',
      headers: { 'cf-connecting-ip': ip },
    }, env);
    expect(limited.status).toBe(429);

    const headerSets: Record<string, string>[] = [
      { 'cf-connecting-ip': ip, Authorization: 'Bearer bogus-token' },
      { 'cf-connecting-ip': ip, Authorization: 'Bearer another-bogus' },
      { 'cf-connecting-ip': ip, Cookie: 'lh_admin_session=bogus-session' },
    ];
    for (const headers of headerSets) {
      const res = await a.request('/api/webhooks/incoming/wh-1/receive', {
        method: 'POST',
        headers,
      }, env);
      expect(res.status).toBe(429);
    }
  });
});
