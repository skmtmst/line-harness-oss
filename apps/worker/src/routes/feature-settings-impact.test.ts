import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { FEATURE_IDS } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { StaffRole } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const access = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: access.canAccess,
}));

const { featureSettings, DEFAULT_DISABLED_FEATURES, FEATURE_IMPACT_COVERAGE } = await import('./feature-settings.js');

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
      // 自アカウントの公開中だけ数え、停止中と名寄せなし行は数えない。
      expect(byFeature.scenarios).toContainEqual(
        { kind: 'published', targetType: '公開中のシナリオ', count: 1 },
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

  it('staff権限では影響確認も保存も不可(保存PUTと同じ権限)', async () => {
    const testDb = createTestD1();
    try {
      seedLiveWork(testDb);
      const impact = await postImpact(testDb, { expectedVersion: 0, features: { broadcasts: false } }, 'account-1', 'staff');
      expect(impact.status).toBe(403);

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

  it('切替対象の全33種が網羅表に載り、数えるか理由を持つ', async () => {
    expect(new Set(Object.keys(FEATURE_IMPACT_COVERAGE))).toEqual(new Set(FEATURE_IDS));
    for (const feature of FEATURE_IDS) {
      const entry = FEATURE_IMPACT_COVERAGE[feature];
      if (entry.scope === 'counted') {
        expect(entry.sources.length).toBeGreaterThan(0);
      } else {
        expect(entry.reason.length).toBeGreaterThan(0);
      }
    }

    // 空DBで全33種をオフにする変更案は通り、有効から変わる分だけ結果が返る。
    // 既定オフの種は遷移しないため対象外になる。
    const testDb = createTestD1();
    try {
      const features = Object.fromEntries(FEATURE_IDS.map((feature) => [feature, false]));
      const { status, body } = await postImpact(testDb, { expectedVersion: 0, features });
      expect(status).toBe(200);
      const expectedOffs = FEATURE_IDS.filter((feature) => !DEFAULT_DISABLED_FEATURES.has(feature));
      expect(body.data.impacts).toHaveLength(expectedOffs.length);
      expect(new Set(
        (body.data.impacts as Array<{ feature: string }>).map((impact) => impact.feature),
      )).toEqual(new Set(expectedOffs));
      expect(body.data.requiresConfirmation).toBe(false);
      expect(body.data.impactToken).toBeNull();
    } finally {
      testDb.raw.close();
    }
  });

  it('他アカウントと名寄せなし行を混ぜず、共有の根拠がある表だけ空行も数える', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.exec(`
        INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
        VALUES
          ('s-a1', '自社', 'manual', 1, 'account-1'),
          ('s-a2', '他社', 'manual', 1, 'account-2'),
          ('s-null', '名寄せなし', 'manual', 1, NULL);
        INSERT INTO auto_replies (id, keyword, response_content, line_account_id, is_active)
        VALUES
          ('ar-a1', '自社', '本文', 'account-1', 1),
          ('ar-a2', '他社', '本文', 'account-2', 1),
          ('ar-shared', '共有', '本文', NULL, 1);
        INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
        VALUES
          ('b-a1', '自社予約', 'text', '本文', 'all', 'scheduled', 'account-1'),
          ('b-a2', '他社予約', 'text', '本文', 'all', 'scheduled', 'account-2'),
          ('b-null', '名寄せなし予約', 'text', '本文', 'all', 'scheduled', NULL);
      `);
      const { status, body } = await postImpact(testDb, {
        expectedVersion: 0,
        features: { scenarios: false, auto_replies: false, broadcasts: false },
      });
      expect(status).toBe(200);
      const byFeature = Object.fromEntries(
        (body.data.impacts as Array<{ feature: string; items: Array<{ targetType: string; count: number }> }>)
          .map((impact) => [impact.feature, impact.items]),
      );
      // シナリオと配信は自社だけ。名寄せなし行は混ぜない。
      expect(byFeature.scenarios).toContainEqual(
        { kind: 'published', targetType: '公開中のシナリオ', count: 1 },
      );
      expect(byFeature.broadcasts).toContainEqual(
        { kind: 'scheduled', targetType: '予約済みの配信', count: 1 },
      );
      // 自動応答だけは読み取り側が共有扱いのため、空行も数える。
      expect(byFeature.auto_replies).toContainEqual(
        { kind: 'published', targetType: '有効な自動応答', count: 2 },
      );
    } finally {
      testDb.raw.close();
    }
  });

  it('新規の数え先と数えない理由の動作を確認する', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.exec(`
        INSERT INTO analytics_report_schedules
          (id, line_account_id, name, sections_json, cadence, weekday, send_time, time_zone, period_days,
           recipients_json, channels_json, status, next_run_at, created_at, updated_at)
        VALUES
          ('rs-active', 'account-1', '週報', '[]', 'weekly', 1, '09:00', 'Asia/Tokyo', 7, '[]', '[]',
           'active', '2099-01-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00'),
          ('rs-paused', 'account-1', '停止中', '[]', 'weekly', 1, '09:00', 'Asia/Tokyo', 7, '[]', '[]',
           'paused', '2099-01-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00');
        INSERT INTO incoming_webhooks (id, name, source_type, line_account_id, is_active)
        VALUES ('wh-on', '受信', 'generic', 'account-1', 1);
        INSERT INTO media (id, kind, filename, mime_type, size_bytes, r2_key)
        VALUES ('m-1', 'image', 'a.png', 'image/png', 10, 'k1');
      `);
      const { status, body } = await postImpact(testDb, {
        expectedVersion: 0,
        features: { analytics: false, external_integrations: false, media: false },
      });
      expect(status).toBe(200);
      expect(body.data.requiresConfirmation).toBe(true);
      const byFeature = Object.fromEntries(
        (body.data.impacts as Array<{ feature: string; blocking: boolean; items: Array<{ targetType: string; count: number }> }>)
          .map((impact) => [impact.feature, impact]),
      );
      expect(byFeature.analytics.items).toContainEqual(
        { kind: 'scheduled', targetType: '有効なレポート予約', count: 1 },
      );
      expect(byFeature.external_integrations.items).toContainEqual(
        { kind: 'published', targetType: '有効な受信Webhook', count: 1 },
      );
      // 素材があっても数えない理由がある機能は空で、保存を止めない。
      expect(byFeature.media).toMatchObject({ blocking: false, items: [] });
    } finally {
      testDb.raw.close();
    }
  });

  it('確認後に版と稼働中が両方変わっても安全に再確認へ戻る', async () => {
    const testDb = createTestD1();
    try {
      seedLiveWork(testDb);
      const impact = await postImpact(testDb, { expectedVersion: 0, features: { broadcasts: false } });
      const token = impact.body.data.impactToken as string;

      // 別の管理者が先に保存して版を進め、その後に予約が増える。
      const other = await putFeatures(testDb, { expectedVersion: 0, features: { media: false } });
      expect(other.status).toBe(200);
      testDb.raw.exec(`
        INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
        VALUES ('b-late', '後からの予約', 'text', '本文', 'all', 'scheduled', 'account-1');
      `);

      // 古い確認では保存できず、最新の件数と一緒に再確認を求められる。
      const stale = await putFeatures(testDb, {
        // 版は最新に合わせても、確認時点の件数と違うため通さない。
        expectedVersion: 1,
        features: { broadcasts: false },
        impactToken: token,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('IMPACT_CONFIRMATION_REQUIRED');
      expect(stale.body.data.impacts[0].items).toContainEqual(
        { kind: 'scheduled', targetType: '予約済みの配信', count: 2 },
      );

      // 取り直した確認では保存できる。
      const fresh = await postImpact(testDb, { expectedVersion: 1, features: { broadcasts: false } });
      expect(fresh.body.data.requiresConfirmation).toBe(true);
      const retry = await putFeatures(testDb, {
        expectedVersion: 1,
        features: { broadcasts: false },
        impactToken: fresh.body.data.impactToken as string,
      });
      expect(retry.status).toBe(200);
    } finally {
      testDb.raw.close();
    }
  });
});
