import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { autoReplies } from './auto-replies.js';

const admin: AuthenticatedStaff = {
  id: 'env-owner',
  name: '管理者',
  role: 'admin',
  readOnly: false,
  tenantId: 'tenant-1',
};

const staff: AuthenticatedStaff = { ...admin, id: 'staff-1', role: 'staff' };

function app(db: D1Database, currentStaff: AuthenticatedStaff = admin) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', currentStaff);
    await next();
  });
  instance.route('/', autoReplies);
  return { instance, bindings: { DB: db, WORKER_URL: 'https://worker.test' } as Env['Bindings'] };
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    keyword: '予約',
    matchType: 'contains',
    responseType: 'text',
    responseContent: '承りました',
    templateId: null,
    lineAccountId: 'account-1',
    activeFrom: null,
    activeUntil: null,
    cooldownMinutes: null,
    skipWhenOperatorActive: false,
    priority: 1,
    receiveSources: ['line'],
    messageKinds: ['text'],
    friendConditions: null,
    actions: null,
    responseWeekdays: null,
    responseHolidayRule: null,
    oncePerFriend: false,
    keywords: null,
    respondToAll: false,
    name: '予約受付',
    keywordMatchMode: 'any',
    folderId: null,
    internalMemo: null,
    replyDelaySeconds: null,
    unmatchedAction: null,
    ...overrides,
  };
}

function insertRule(raw: SqliteD1['raw'], id: string, keyword: string, priority: number) {
  raw.prepare(
    `INSERT INTO auto_replies
       (id, keyword, match_type, response_content, line_account_id, is_active,
        priority, message_kinds_json, name, current_draft_version_id, created_at)
     VALUES (?, ?, 'contains', '返信', 'account-1', 1, ?, '["text"]', ?, ?, ?)`,
  ).run(id, keyword, priority, `${keyword}受付`, `version-${id}`, `2026-09-01T00:00:0${priority}.000`);
  raw.prepare(
    `INSERT INTO auto_reply_versions
       (id, auto_reply_id, version_number, line_account_id, definition_snapshot,
        status, created_at, updated_at)
     VALUES (?, ?, 2, 'account-1', ?, 'draft', '2026-09-01T00:00:00.000', '2026-09-01T00:00:00.000')`,
  ).run(`version-${id}`, id, JSON.stringify(settings({ keyword, priority, name: `${keyword}受付` })));
}

describe('点検・中: 自動応答の下書き確認・上限・ページ送り', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    testDb.raw.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-1', 'channel-1', '店舗1', '', '', 1, 'tenant-1')`,
    ).run();
    insertRule(testDb.raw, 'rule-1', '予約', 1);
    insertRule(testDb.raw, 'rule-2', '予約変更', 2);
  });

  it('中3: 当たり回数が数えられないときはhitsを付けず0で埋めない', async () => {
    testDb.raw.exec('DROP TABLE auto_reply_hits');
    const target = app(testDb.db);
    const response = await target.instance.request('/api/auto-replies?accountId=account-1', {}, target.bindings);
    const body = await response.json() as { data: Array<{ hits?: unknown }> };

    expect(response.status).toBe(200);
    expect(body.data.length).toBe(2);
    expect(body.data.every((item) => item.hits === undefined)).toBe(true);
  });

  it('中3: 数えられるときはhitsが付く', async () => {
    const target = app(testDb.db);
    const response = await target.instance.request('/api/auto-replies?accountId=account-1', {}, target.bindings);
    const body = await response.json() as { data: Array<{ hits?: unknown }> };

    expect(response.status).toBe(200);
    expect(body.data.every((item) => item.hits !== undefined)).toBe(true);
  });

  it.each([
    ['validate', 'POST', '/api/auto-replies/rule-1/validate'],
    ['conflicts', 'GET', '/api/auto-replies/rule-1/conflicts'],
    ['test', 'POST', '/api/auto-replies/rule-1/test'],
  ])('中5: 下書きの%sはstaffに403を返す', async (_label, method, path) => {
    const target = app(testDb.db, staff);
    const response = await target.instance.request(path, method === 'GET' ? { method } : {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ friendId: 'friend-1', incomingText: '予約' }),
    }, target.bindings);

    expect(response.status).toBe(403);
  });

  it('中5: 下書きのvalidateはadminなら403にならない', async () => {
    const target = app(testDb.db, admin);
    const response = await target.instance.request('/api/auto-replies/rule-1/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }, target.bindings);

    expect(response.status).not.toBe(403);
  });

  it('中6: 下書き保存は言葉・本文・複数言葉の上限を超えたら400', async () => {
    const target = app(testDb.db);
    const put = (body: Record<string, unknown>) => target.instance.request('/api/auto-replies/rule-1/draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, target.bindings);

    const longKeyword = await put(settings({ keyword: 'あ'.repeat(201) }));
    expect(longKeyword.status).toBe(400);

    const longContent = await put(settings({ responseContent: 'あ'.repeat(5001) }));
    expect(longContent.status).toBe(400);

    const manyKeywords = await put(settings({
      keywords: Array.from({ length: 101 }, (_, i) => ({ keyword: `語${i}`, matchType: 'contains' })),
    }));
    expect(manyKeywords.status).toBe(400);

    const longKeywordItem = await put(settings({
      keywords: [{ keyword: 'あ'.repeat(201), matchType: 'contains' }],
    }));
    expect(longKeywordItem.status).toBe(400);

    const bigConditions = await put(settings({ friendConditions: { note: 'あ'.repeat(20001) } }));
    expect(bigConditions.status).toBe(400);
  });

  it('中6: 直接作成も言葉・本文の上限を超えたら400', async () => {
    const target = app(testDb.db);
    const post = (body: Record<string, unknown>) => target.instance.request('/api/auto-replies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, target.bindings);

    expect((await post({ keyword: 'あ'.repeat(201), lineAccountId: 'account-1', responseContent: 'ok' })).status).toBe(400);
    expect((await post({ keyword: '予約', lineAccountId: 'account-1', responseContent: 'あ'.repeat(5001) })).status).toBe(400);
  });

  it('中7: page/limit付きは共通一覧契約の形で返し、無しは配列のまま', async () => {
    const target = app(testDb.db);
    const paged = await target.instance.request('/api/auto-replies?accountId=account-1&page=2&limit=1', {}, target.bindings);
    const pagedBody = await paged.json() as {
      data: { items: Array<{ id: string }>; total: number; limit: number; sort: unknown };
    };

    expect(paged.status).toBe(200);
    expect(pagedBody.data.items).toHaveLength(1);
    expect(pagedBody.data.total).toBe(2);
    expect(pagedBody.data.limit).toBe(1);
    expect(pagedBody.data.sort).toEqual([
      { field: 'priority', direction: 'asc' },
      { field: 'created_at', direction: 'asc' },
    ]);

    const legacy = await target.instance.request('/api/auto-replies?accountId=account-1', {}, target.bindings);
    const legacyBody = await legacy.json() as { data: unknown };
    expect(legacy.status).toBe(200);
    expect(Array.isArray(legacyBody.data)).toBe(true);
  });

  it('中4: 直接更新はowner/adminだけが使え、一時停止に使える', async () => {
    const asStaff = app(testDb.db, staff);
    const denied = await asStaff.instance.request('/api/auto-replies/rule-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    }, asStaff.bindings);
    expect(denied.status).toBe(403);

    const target = app(testDb.db);
    const response = await target.instance.request('/api/auto-replies/rule-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    }, target.bindings);
    expect(response.status).toBe(200);
  });
});
