import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { friends } from './friends.js';

/*
 * N-036: GET /api/friends/:id が一覧と同じ「first_tracked_link_id →
 * tracked_links.name」基準で firstTrackedLinkName を返すかを確かめる。
 *
 * 一覧（?includeChatStatus=true）は LEFT JOIN で流入元名を出しているが、
 * 詳細はこれまで返していなかったため、詳細画面の「流入元」は常に
 * 「不明」になっていた。流入元あり→名前、なし→従来どおり不明（null）、
 * 別アカウント→404、を実SQLite＋実route＋実authで見る。
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000002';

function createApp(db: D1Database) {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', friends);
  return {
    app,
    env: { DB: db } as Env['Bindings'],
  };
}

function seedFixture(testDb: SqliteD1): void {
  testDb.raw.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)')
    .run(DEFAULT_TENANT_ID, '既定統括');
  testDb.raw.prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)')
    .run(OTHER_TENANT_ID, '別統括');

  testDb.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES (?, ?, ?, 'token', 'secret', 1, ?)
  `).run('account-a', 'channel-a', '店舗A', DEFAULT_TENANT_ID);
  testDb.raw.prepare(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
    VALUES (?, ?, ?, 'token', 'secret', 1, ?)
  `).run('account-foreign', 'channel-foreign', '別統括店舗', OTHER_TENANT_ID);

  testDb.raw.prepare(`
    INSERT INTO staff_members
      (id, name, role, access_level, api_key, permission_keys, account_scope, tenant_id)
    VALUES ('staff-all', '全店舗担当', 'staff', 'full', 'key-all', '["/friends"]', 'all', ?)
  `).run(DEFAULT_TENANT_ID);

  // 流入元（追跡リンク）。一覧側が LEFT JOIN している同じ表。
  testDb.raw.prepare(`
    INSERT INTO tracked_links (id, name, original_url, is_active, created_at, updated_at)
    VALUES ('link-campaign', '春のキャンペーンLP', 'https://example.com/spring', 1, '2026-01-01', '2026-01-01')
  `).run();

  const createdAt = '2026-01-01T00:00:00.000Z';
  insertFriend(testDb.raw, 'friend-linked', {
    line_account_id: 'account-a',
    first_tracked_link_id: 'link-campaign',
    created_at: createdAt,
    updated_at: createdAt,
  });
  insertFriend(testDb.raw, 'friend-no-link', {
    line_account_id: 'account-a',
    first_tracked_link_id: null,
    created_at: createdAt,
    updated_at: createdAt,
  });
  // リンク先が消えている（参照だけ残る）ケース。一覧はLEFT JOINでnullになる。
  insertFriend(testDb.raw, 'friend-ghost-link', {
    line_account_id: 'account-a',
    first_tracked_link_id: 'link-deleted',
    created_at: createdAt,
    updated_at: createdAt,
  });
  insertFriend(testDb.raw, 'friend-foreign', {
    line_account_id: 'account-foreign',
    first_tracked_link_id: 'link-campaign',
    created_at: createdAt,
    updated_at: createdAt,
  });
}

type DetailResponse = {
  success: boolean;
  data?: { id: string; firstTrackedLinkName?: string | null };
  error?: string;
};
type ListResponse = {
  success: boolean;
  data: { items: Array<{ id: string; firstTrackedLinkName?: string | null }> };
};

describe('N-036 友だち詳細の流入元（firstTrackedLinkName）', () => {
  let testDb: SqliteD1;
  let target: ReturnType<typeof createApp>;

  beforeEach(() => {
    testDb = createTestD1();
    seedFixture(testDb);
    target = createApp(testDb.db);
  });

  afterEach(() => {
    testDb.raw.close();
  });

  async function get(path: string, apiKey?: string): Promise<Response> {
    return target.app.request(path, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    }, target.env);
  }

  it('流入元がある友だちは詳細でその名前を返す', async () => {
    const res = await get('/api/friends/friend-linked', 'key-all');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailResponse;
    expect(body.success).toBe(true);
    expect(body.data?.firstTrackedLinkName).toBe('春のキャンペーンLP');
  });

  it('流入元が無い友だちは null を返す（画面は従来どおり「不明」になる）', async () => {
    const res = await get('/api/friends/friend-no-link', 'key-all');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailResponse;
    expect(body.data?.firstTrackedLinkName).toBeNull();
  });

  it('リンク先が消えている場合も一覧と同じく null になる', async () => {
    const res = await get('/api/friends/friend-ghost-link', 'key-all');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailResponse;
    expect(body.data?.firstTrackedLinkName).toBeNull();
  });

  it('別統括（見えないアカウント）の友だちは従来どおり404', async () => {
    const res = await get('/api/friends/friend-foreign', 'key-all');
    expect(res.status).toBe(404);
  });

  it('一覧と詳細で同じ流入元名になる（同じ基準）', async () => {
    const [listRes, detailRes] = await Promise.all([
      get('/api/friends?includeChatStatus=true&includeTags=false&limit=50', 'key-all'),
      get('/api/friends/friend-linked', 'key-all'),
    ]);
    expect(listRes.status).toBe(200);
    expect(detailRes.status).toBe(200);
    const list = (await listRes.json()) as ListResponse;
    const detail = (await detailRes.json()) as DetailResponse;
    const listRow = list.data.items.find((item) => item.id === 'friend-linked');
    expect(listRow).toBeDefined();
    expect(listRow?.firstTrackedLinkName).toBe('春のキャンペーンLP');
    expect(detail.data?.firstTrackedLinkName).toBe(listRow?.firstTrackedLinkName);
  });

  it('未認証は詳細も開けない', async () => {
    const res = await get('/api/friends/friend-linked');
    expect(res.status).toBe(401);
  });
});
