import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { autoReplies } from './auto-replies.js';

/*
 * F7: 自動応答の作成時に競合を自動確認する。
 * - 有効(isActive: true)で作り、既存の有効ルールと当たらない → すぐ有効。
 * - 有効で作り、既存の有効ルールと当たる → 有効化せず停止中で作り、
 *   理由を社内メモへ残し、応答に競合の一覧を返す。
 * - 停止(isActive: false/省略)で作る → 従来どおり停止のまま
 *   (AUTOREPLY-08 の契約を変えない)。入力メモは壊さない。
 */
const admin: AuthenticatedStaff = {
  id: 'env-owner',
  name: '管理者',
  role: 'admin',
  readOnly: false,
  tenantId: 'tenant-1',
};

function app(db: D1Database, currentStaff: AuthenticatedStaff = admin) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', currentStaff);
    await next();
  });
  instance.route('/', autoReplies);
  return { instance, bindings: { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings'] };
}

function request(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

interface CreatedBody {
  data: {
    id: string;
    isActive: boolean;
    lifecycleStatus: string;
    internalMemo: string | null;
    conflicts?: Array<{ autoReplyId: string; reason: string }>;
    conflictDetected?: boolean;
    activationBlocked?: boolean;
  };
}

describe('F7: 作成時の競合自動確認', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    testDb.raw.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-1', 'channel-1', '店舗1', '', '', 1, 'tenant-1')`,
    ).run();
  });

  const post = (body: Record<string, unknown>) => {
    const target = app(testDb.db);
    return target.instance.request('/api/auto-replies', request('POST', body), target.bindings);
  };

  const baseRule = (overrides: Record<string, unknown> = {}) => ({
    keyword: '予約',
    matchType: 'contains',
    responseType: 'text',
    responseContent: '承りました',
    lineAccountId: 'account-1',
    ...overrides,
  });

  it('競合がなければ有効指定のまま作る', async () => {
    const res = await post(baseRule({ isActive: true }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreatedBody;
    expect(body.data.isActive).toBe(true);
    expect(body.data.conflictDetected ?? false).toBe(false);
    expect(body.data.activationBlocked ?? false).toBe(false);
  });

  it('競合があれば有効化せず停止中で作り理由を残す', async () => {
    const first = await post(baseRule({ isActive: true }));
    expect(first.status).toBe(201);
    expect(((await first.json()) as CreatedBody).data.isActive).toBe(true);

    const second = await post(baseRule({ isActive: true, responseContent: '別の応答' }));
    expect(second.status).toBe(201);
    const body = (await second.json()) as CreatedBody;
    // 有効化しない。
    expect(body.data.isActive).toBe(false);
    expect(body.data.activationBlocked).toBe(true);
    // 理由が残る。
    expect(body.data.internalMemo).toContain('競合');
    expect(body.data.conflicts?.length ?? 0).toBeGreaterThan(0);
    expect(body.data.conflictDetected).toBe(true);

    // DB上も停止中。
    const row = testDb.raw.prepare(`SELECT is_active FROM auto_replies WHERE id = ?`).get(
      body.data.id,
    ) as { is_active: number };
    expect(row.is_active).toBe(0);
  });

  it('停止指定の作成は競合があっても入力メモを壊さない', async () => {
    await post(baseRule({ isActive: true }));
    const memo = '担当メモ';
    const res = await post(baseRule({ isActive: false, internalMemo: memo }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreatedBody;
    expect(body.data.isActive).toBe(false);
    expect(body.data.internalMemo).toBe(memo);
  });

  it('言葉が違えば競合にならず有効のまま作る', async () => {
    await post(baseRule({ isActive: true }));
    // 完全一致の別言葉は、部分一致の既存ルールとも重ならない。
    const res = await post(baseRule({ keyword: '営業時間', matchType: 'exact', isActive: true }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreatedBody;
    expect(body.data.isActive).toBe(true);
  });
});
