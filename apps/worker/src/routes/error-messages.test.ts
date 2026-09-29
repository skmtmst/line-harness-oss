import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * エラー文面の対応表（要件 v6-34 §9）。台帳 #134。
 *
 * **表をそのまま返すだけ。** 文面の選び方は画面側が持つ。
 */

const ROWS = [
  {
    code: 'Internal Server Error',
    message: '処理できませんでした（追跡番号 {incidentId}）',
    next_action_kind: 'retry' as const,
    next_action_target: null,
    source: 'index.ts',
    version: 1,
  },
  {
    code: 'FEATURE_DISABLED',
    message: 'この機能は機能設定でオフになっています',
    next_action_kind: 'navigate' as const,
    next_action_target: '/settings/features',
    source: 'feature gates',
    version: 1,
  },
];

const db = { listErrorMessages: vi.fn(async () => ROWS) };
vi.mock('@line-crm/db', () => db);

const { errorMessages } = await import('./error-messages.js');

function makeApp(role: 'owner' | 'admin' | 'staff' = 'staff') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'u-1', name: 'テスト', role, readOnly: false, permissionKeys: [] });
    return next();
  });
  app.route('/', errorMessages);
  return app;
}

describe('GET /api/error-messages', () => {
  it('コード・文面・次の行動を返す', async () => {
    const res = await makeApp().fetch(
      new Request('https://example.com/api/error-messages'),
      { DB: {} as D1Database },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: Array<{
        code: string;
        message: string;
        nextAction: { kind: string; target: string | null };
        source: string;
      }>;
    };
    const internal = body.data.find((row) => row.code === 'Internal Server Error');
    expect(internal?.message).toContain('追跡番号');
    expect(internal?.nextAction.kind).toBe('retry');
    const disabled = body.data.find((row) => row.code === 'FEATURE_DISABLED');
    expect(disabled?.nextAction).toEqual({ kind: 'navigate', target: '/settings/features' });
  });

  it('表の読み込みに失敗しても500で応答する（ハングしない）', async () => {
    db.listErrorMessages.mockRejectedValueOnce(new Error('D1 down'));
    const res = await makeApp().fetch(
      new Request('https://example.com/api/error-messages'),
      { DB: {} as D1Database },
    );
    expect(res.status).toBe(500);
  });
});
