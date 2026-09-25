/*
 * P0-3 外部連携の秘密を平文で保存しない＋検証してから「つながった」。
 * 実 SQLite（createTestD1）に本物のルータを通す。
 *
 * - 秘密（access_token 等）は AES-GCM で暗号化して別カラムへ。config JSON に残さない。
 * - 読み口は秘密値を返さず、設定済みの鍵名だけ返す。
 * - isActive:true は疎通確認（テスト送信の成功）が済んだ行だけ。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(async () => true),
  getVisibleLineAccountScope: vi.fn(async () => ({
    allowedAccountIds: ['a1'], canSeeUnassigned: true,
  })),
}));

const { adPlatforms } = await import('./ad-platforms.js');

const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SECRET = 'secret-token-1234567890abcdef';

function app(db: D1Database, role: 'owner' | 'staff' = 'owner') {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db, LINE_CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY } as unknown as Env['Bindings'];
    c.set('staff', { id: 'staff-1', name: '担当', role, readOnly: false, tenantId: 'tenant-a' });
    return next();
  });
  instance.route('/', adPlatforms);
  return instance;
}

function json(method: string, body: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function rawConfig(testDb: SqliteD1, id: string) {
  return testDb.raw.prepare(
    `SELECT config, config_encrypted, verified_at, is_active FROM ad_platforms WHERE id = ?`,
  ).get(id) as { config: string; config_encrypted: string | null; verified_at: string | null; is_active: number };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => 'ok' })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('広告連携の秘密の保管と接続確認', () => {
  it('作成時に秘密は暗号化して別カラムへ。config JSON に平文を残さない', async () => {
    const testDb = createTestD1();
    const response = await app(testDb.db).request('/api/ad-platforms', json('POST', {
      name: 'meta',
      config: { pixel_id: 'PIXEL-1', access_token: SECRET, click_id_validity_days: 30 },
      lineAccountId: 'a1',
    }));
    expect(response.status).toBe(201);
    const created = (await response.json()) as { data: { id: string } };

    const stored = rawConfig(testDb, created.data.id);
    expect(stored.config).not.toContain(SECRET);
    expect(JSON.parse(stored.config)).toMatchObject({ pixel_id: 'PIXEL-1', click_id_validity_days: 30 });
    expect(stored.config_encrypted).toBeTruthy();
    expect(stored.config_encrypted).not.toContain(SECRET);
  });

  it('読み口は秘密値を返さず、設定済みの鍵名だけ返す', async () => {
    const testDb = createTestD1();
    const created = await app(testDb.db).request('/api/ad-platforms', json('POST', {
      name: 'meta',
      config: { pixel_id: 'PIXEL-1', access_token: SECRET },
      lineAccountId: 'a1',
    }));
    const id = ((await created.json()) as { data: { id: string } }).data.id;

    const response = await app(testDb.db).request('/api/ad-platforms?lineAccountId=a1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string; config: Record<string, unknown>; secretKeys: string[] }> };
    const item = body.data.find((row) => row.id === id)!;
    expect(JSON.stringify(item.config)).not.toContain(SECRET);
    expect(item.config.pixel_id).toBe('PIXEL-1');
    expect(item.secretKeys).toContain('access_token');
  });

  it('決められていない設定キーは受け付けない', async () => {
    const testDb = createTestD1();
    const response = await app(testDb.db).request('/api/ad-platforms', json('POST', {
      name: 'meta',
      config: { pixel_id: 'PIXEL-1', evil_key: 'x' },
      lineAccountId: 'a1',
    }));
    expect(response.status).toBe(400);
  });

  it('疎通確認が済むまで有効化できない', async () => {
    const testDb = createTestD1();
    const created = await app(testDb.db).request('/api/ad-platforms', json('POST', {
      name: 'meta',
      config: { pixel_id: 'PIXEL-1', access_token: SECRET, click_id_validity_days: 30 },
      lineAccountId: 'a1',
    }));
    const id = ((await created.json()) as { data: { id: string } }).data.id;

    const response = await app(testDb.db).request(
      `/api/ad-platforms/${id}`, json('PUT', { isActive: true }),
    );
    expect(response.status).toBe(422);
    expect(rawConfig(testDb, id).is_active).toBe(0);
  });

  it('テスト送信が成功すると確認済みになり、有効化できる', async () => {
    const testDb = createTestD1();
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('a1', 'channel-a1', 'A1', 'token', 'secret')`,
    ).run();
    insertFriend(testDb.raw, 'f1', { line_account_id: 'a1' });
    testDb.raw.prepare(
      `INSERT INTO ref_tracking
         (id, ref_code, friend_id, fbclid, line_account_id, ad_conversion_consent_at, created_at)
       VALUES ('ref-1', 'ref-1', 'f1', 'fb-click-1', 'a1', '2026-09-25T10:00:00+09:00', '2026-09-25T10:00:00+09:00')`,
    ).run();
    const created = await app(testDb.db).request('/api/ad-platforms', json('POST', {
      name: 'meta',
      config: { pixel_id: 'PIXEL-1', access_token: SECRET, click_id_validity_days: 3650 },
      lineAccountId: 'a1',
    }));
    expect(created.status).toBe(201);

    const tested = await app(testDb.db).request('/api/ad-platforms/test', json('POST', {
      platform: 'meta', eventName: 'Purchase', friendId: 'f1',
    }));
    expect(tested.status).toBe(200);
    const testedBody = (await tested.json()) as { data: { verified: boolean } };
    expect(testedBody.data.verified).toBe(true);

    const listed = await app(testDb.db).request('/api/ad-platforms?lineAccountId=a1');
    const id = ((await listed.json()) as { data: Array<{ id: string }> }).data[0].id;
    expect(rawConfig(testDb, id).verified_at).toBeTruthy();

    const enabled = await app(testDb.db).request(
      `/api/ad-platforms/${id}`, json('PUT', { isActive: true }),
    );
    expect(enabled.status).toBe(200);
  });

  it('昔の平文の行も送れる（移行期間の互換）', async () => {
    const testDb = createTestD1();
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('a1', 'channel-a1', 'A1', 'token', 'secret')`,
    ).run();
    insertFriend(testDb.raw, 'f1', { line_account_id: 'a1' });
    testDb.raw.prepare(
      `INSERT INTO ref_tracking
         (id, ref_code, friend_id, fbclid, line_account_id, ad_conversion_consent_at, created_at)
       VALUES ('ref-1', 'ref-1', 'f1', 'fb-click-1', 'a1', '2026-09-25T10:00:00+09:00', '2026-09-25T10:00:00+09:00')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO ad_platforms (id, name, display_name, config, is_active, line_account_id, created_at, updated_at)
       VALUES ('p-legacy', 'meta', 'Meta広告',
         '{"pixel_id":"PIXEL-1","access_token":"legacy-token","click_id_validity_days":3650}',
         1, 'a1', '2026-09-25T10:00:00+09:00', '2026-09-25T10:00:00+09:00')`,
    ).run();

    const { sendAdConversions } = await import('../services/ad-conversion.js');
    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000);
    const sent = testDb.raw.prepare(
      `SELECT status FROM ad_conversion_logs WHERE ad_platform_id = 'p-legacy'`,
    ).all() as Array<{ status: string }>;
    expect(sent).toHaveLength(1);
    expect(sent[0].status).toBe('sent');
  });
});
