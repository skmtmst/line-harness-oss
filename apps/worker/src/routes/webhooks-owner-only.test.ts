import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { webhooks } from './webhooks.js';

/*
 * R32: 受け取り口・送り先の作成・変更・削除は統括だけ。
 * 口側の守り（`requireRole('owner')`）がそのままであることを、
 * 管理者・スタッフの 403 行列で守る。画面側の直しを戻しても、
 * この試験は口側が守りのままであることを示す。
 *
 * 権限の門番より先に DB・step-up へ触れないため、DB の代役は要らない。
 * 403 の応答が内部の詳細を漏らさないことも見る。
 */
function setupApp(role: 'owner' | 'admin' | 'staff') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', {
      id: 'staff-1', name: 'Staff', role, readOnly: false, tenantId: undefined,
    });
    return next();
  });
  app.route('/', webhooks);
  return app;
}

const baseEnv = { DB: {} } as Record<string, unknown>;

const OWNER_ONLY_CALLS: Array<{ method: string; path: string; body?: unknown }> = [
  { method: 'POST', path: '/api/webhooks/incoming', body: { name: 'x', secret: 's'.repeat(32), lineAccountId: 'a' } },
  { method: 'PUT', path: '/api/webhooks/incoming/iwh-1?lineAccountId=a', body: { name: 'x' } },
  { method: 'DELETE', path: '/api/webhooks/incoming/iwh-1?lineAccountId=a' },
  { method: 'PATCH', path: '/api/webhooks/incoming/iwh-1/config?lineAccountId=a', body: {} },
  { method: 'POST', path: '/api/webhooks/outgoing', body: { name: 'x' } },
  { method: 'PUT', path: '/api/webhooks/outgoing/owh-1?lineAccountId=a', body: { name: 'x' } },
  { method: 'DELETE', path: '/api/webhooks/outgoing/owh-1?lineAccountId=a' },
  { method: 'POST', path: '/api/webhooks/api-tokens', body: { name: 'x' } },
];

describe('webhooks の統括限定操作は管理者・スタッフを通さない（R32）', () => {
  for (const role of ['admin', 'staff'] as const) {
    test(`${role} は作成・変更・削除で 403 になる`, async () => {
      const app = setupApp(role);
      for (const call of OWNER_ONLY_CALLS) {
        const res = await app.request(call.path, {
          method: call.method,
          headers: { 'Content-Type': 'application/json' },
          body: call.body === undefined ? undefined : JSON.stringify(call.body),
        }, baseEnv);
        expect(res.status, `${role} ${call.method} ${call.path}`).toBe(403);
        const payload = await res.json() as { success: boolean; error: string };
        expect(payload.success).toBe(false);
        expect(payload.error).toContain('権限');
        expect(JSON.stringify(payload)).not.toContain('SELECT');
      }
    });
  }

  test('統括は門番を通る（step-up の手前で止めない）', async () => {
    const app = setupApp('owner');
    const res = await app.request('/api/webhooks/incoming', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', secret: 's'.repeat(32), lineAccountId: 'a' }),
    }, baseEnv);
    // 本人確認（step-up）が先に求められる＝役割の門番は通った。
    expect(res.status).not.toBe(403);
  });
});
