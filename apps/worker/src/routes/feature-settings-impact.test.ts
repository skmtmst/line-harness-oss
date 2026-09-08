import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import type { StaffRole } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const access = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: access.canAccess,
}));

const { featureSettings } = await import('./feature-settings.js');

function app(role: StaffRole = 'owner') {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner',
      name: 'Owner',
      role,
      readOnly: false,
      tenantId: 'tenant-a',
    });
    await next();
  });
  instance.route('/', featureSettings);
  return instance;
}

const ENV = { RESTAURANT_TEST_ENABLED: 'true' } as Record<string, string>;

function seedLiveWork(db: SqliteD1) {
  db.raw.exec(`
    INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
    VALUES
      ('b-scheduled', '予約配信', 'text', '本文', 'all', 'scheduled', 'account-1'),
      ('b-sending-other', '送信中(別)', 'text', '本文', 'all', 'sending', 'account-9'),
      ('b-draft', '下書き', 'text', '本文', 'all', 'draft', 'account-1');
    INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
    VALUES
      ('s-active', '公開シナリオ', 'manual', 1, 'account-1'),
      ('s-shared', '共有シナリオ', 'manual', 1, NULL),
      ('s-stopped', '停止中', 'manual', 0, 'account-1');
    INSERT INTO auto_replies (id, keyword, response_content, template_id, line_account_id, is_active)
    VALUES ('ar-template', '営業時間', '9時からです', 'tpl-1', 'account-1', 1);
  `);
}

async function postImpact(
  testDb: SqliteD1,
  body: unknown,
  accountId = 'account-1',
  staffRole: StaffRole = 'owner',
) {
  const response = await app(staffRole).request(
    `/api/settings/features/impact?account_id=${accountId}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    { DB: testDb.db, ...ENV },
  );
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function putFeatures(
  testDb: SqliteD1,
  body: unknown,
  accountId = 'account-1',
  staffRole: StaffRole = 'owner',
) {
  const response = await app(staffRole).request(
    `/api/settings/features?account_id=${accountId}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    { DB: testDb.db, ...ENV },
  );
  return { status: response.status, body: await response.json() as Record<string, any> };
}

beforeEach(() => {
  vi.clearAllMocks();
  access.canAccess.mockResolvedValue(true);
});

describe('feature off impact check', () => {
  it('off前に公開中・予約中・依存機能の件数と対象種別を返す', async () => {
    const testDb = createTestD1();
    try {
      seedLiveWork(testDb);
      const { status, body } = await postImpact(testDb, {
        expectedVersion: 0,
        features: { broadcasts: false, scenarios: false, templates: false },
      });
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.requiresConfirmation).toBe(true);
      expect(typeof body.data.impactToken).toBe('string');

      const byFeature = Object.fromEntries(
        (body.data.impacts as Array<{ feature: string; items: Array<{ kind: string; targetType: string; count: number }> }>)
          .map((impact) => [impact.feature, impact.items]),
      );
      // 別アカウントの送信中と下書きは数えない。
      expect(byFeature.broadcasts).toContainEqual(
        { kind: 'scheduled', targetType: '予約済みの配信', count: 1 },
      );
      expect(byFeature.broadcasts.some((item) => item.targetType === '送信中の配信')).toBe(false);
      // 自アカウントと共有の公開中を数え、停止中は数えない。
      expect(byFeature.scenarios).toContainEqual(
        { kind: 'published', targetType: '公開中のシナリオ', count: 2 },
      );
      // テンプレートは使う側の自動応答が依存として返る。
      expect(byFeature.templates).toContainEqual(
        { kind: 'dependent', targetType: 'テンプレートを使う自動応答', count: 1 },
      );
    } finally {
      testDb.raw.close();
    }
  });

  it('影響0の影響確認はトークンなしで、保存も通常どおりできる', async () => {
    const testDb = createTestD1();
    try {
      const impact = await postImpact(testDb, { expectedVersion: 0, features: { media: false } });
      expect(impact.status).toBe(200);
      expect(impact.body.data.requiresConfirmation).toBe(false);
      expect(impact.body.data.impactToken).toBeNull();

      const saved = await putFeatures(testDb, { expectedVersion: 0, features: { media: false } });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ success: true, data: { version: 1 } });
    } finally {
      testDb.raw.close();
    }
  });

  it('影響ありの保存は確認トークンなしで保存不可(直接PUTの迂回も止める)', async () => {
    const testDb = createTestD1();
    try {
      seedLiveWork(testDb);
      const direct = await putFeatures(testDb, { expectedVersion: 0, features: { broadcasts: false } });
      expect(direct.status).toBe(409);
      expect(direct.body.code).toBe('IMPACT_CONFIRMATION_REQUIRED');
      expect(direct.body.data.impacts[0].feature).toBe('broadcasts');
      expect(direct.body.data.impacts[0].blocking).toBe(true);

      // 偽造トークンも通さない。
      const forged = await putFeatures(testDb, {
        expectedVersion: 0,
        features: { broadcasts: false },
        impactToken: 'forged-token',
      });
      expect(forged.status).toBe(409);
      expect(forged.body.code).toBe('IMPACT_CONFIRMATION_REQUIRED');

      // 保存されていないことを確かめる。
      const loaded = await app().request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: testDb.db, ...ENV },
      );
      expect(await loaded.json()).toMatchObject({
        success: true,
        data: { version: 0, features: { broadcasts: true } },
      });
    } finally {
      testDb.raw.close();
    }
  });

  it('確認トークン付きで保存でき、同じトークンの使い回しは不可', async () => {
    const testDb = createTestD1();
    try {
      seedLiveWork(testDb);
      const impact = await postImpact(testDb, { expectedVersion: 0, features: { broadcasts: false } });
      const token = impact.body.data.impactToken as string;

      const first = await putFeatures(testDb, {
        expectedVersion: 0,
        features: { broadcasts: false },
        impactToken: token,
      });
      expect(first.status).toBe(200);

      // オンに戻してから同じトークンで切り直すと版が変わっているため再確認になる。
      const backOn = await putFeatures(testDb, { expectedVersion: 1, features: { broadcasts: true } });
      expect(backOn.status).toBe(200);
      const replay = await putFeatures(testDb, {
        expectedVersion: 2,
        features: { broadcasts: false },
        impactToken: token,
      });
      expect(replay.status).toBe(409);
      expect(replay.body.code).toBe('IMPACT_CONFIRMATION_REQUIRED');
    } finally {
      testDb.raw.close();
    }
  });

  it('確認後に稼働中が変わったら再確認になる', async () => {
    const testDb = createTestD1();
    try {
      seedLiveWork(testDb);
      const impact = await postImpact(testDb, { expectedVersion: 0, features: { broadcasts: false } });
      const token = impact.body.data.impactToken as string;

      testDb.raw.exec(`
        INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
        VALUES ('b-late', '後からの予約', 'text', '本文', 'all', 'scheduled', 'account-1');
      `);

      const saved = await putFeatures(testDb, {
        expectedVersion: 0,
        features: { broadcasts: false },
        impactToken: token,
      });
      expect(saved.status).toBe(409);
      expect(saved.body.code).toBe('IMPACT_CONFIRMATION_REQUIRED');
      expect(saved.body.data.impacts[0].items).toContainEqual(
        { kind: 'scheduled', targetType: '予約済みの配信', count: 2 },
      );
    } finally {
      testDb.raw.close();
    }
  });

  it('競合更新時は再確認になる(古い版のトークンでは保存不可)', async () => {
    const testDb = createTestD1();
    try {
      seedLiveWork(testDb);
      const impact = await postImpact(testDb, { expectedVersion: 0, features: { broadcasts: false } });
      const token = impact.body.data.impactToken as string;

      const other = await putFeatures(testDb, { expectedVersion: 0, features: { media: false } });
      expect(other.status).toBe(200);

      const stale = await putFeatures(testDb, {
        expectedVersion: 0,
        features: { broadcasts: false },
        impactToken: token,
      });
      expect(stale.status).toBe(409);
    } finally {
      testDb.raw.close();
    }
  });

  it('他アカウントの影響確認と保存は403', async () => {
    const testDb = createTestD1();
    try {
      access.canAccess.mockResolvedValue(false);
      const prepare = vi.fn();
      const impact = await app().request('/api/settings/features/impact?account_id=other', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: { broadcasts: false } }),
      }, { DB: { prepare } as unknown as D1Database });
      expect(impact.status).toBe(403);
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      testDb.raw.close();
    }
  });

  it('staff権限では保存不可(影響確認の読み取りは可)', async () => {
    const testDb = createTestD1();
    try {
      seedLiveWork(testDb);
      const impact = await postImpact(testDb, { expectedVersion: 0, features: { broadcasts: false } }, 'account-1', 'staff');
      expect(impact.status).toBe(200);

      const saved = await putFeatures(
        testDb,
        { expectedVersion: 0, features: { media: false }, impactToken: 'unused' },
        'account-1',
        'staff',
      );
      expect(saved.status).toBe(403);
    } finally {
      testDb.raw.close();
    }
  });
});
