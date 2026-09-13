import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID, FEATURE_IDS } from '@line-crm/shared';
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
      tenantId: DEFAULT_TENANT_ID,
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
      expect(byFeature.broadcasts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'scheduled', targetType: '予約済みの配信', count: 1 }),
        ]),
      );
      expect(byFeature.broadcasts.some((item) => item.targetType === '送信中の配信')).toBe(false);
      // 自アカウントの公開中だけ数え、停止中と名寄せなし行は数えない。
      expect(byFeature.scenarios).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'published', targetType: '公開中のシナリオ', count: 1 }),
        ]),
      );
      // テンプレートは使う側の自動応答が依存として返る。
      expect(byFeature.templates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'dependent', targetType: 'テンプレートを使う自動応答', count: 1 }),
        ]),
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
      expect(saved.body.data.impacts[0].items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'scheduled', targetType: '予約済みの配信', count: 2 }),
        ]),
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
      expect(byFeature.scenarios).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'published', targetType: '公開中のシナリオ', count: 1 }),
        ]),
      );
      expect(byFeature.broadcasts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'scheduled', targetType: '予約済みの配信', count: 1 }),
        ]),
      );
      // 自動応答だけは読み取り側が共有扱いのため、空行も数える。
      expect(byFeature.auto_replies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'published', targetType: '有効な自動応答', count: 2 }),
        ]),
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
      expect(byFeature.analytics.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'scheduled', targetType: '有効なレポート予約', count: 1 }),
        ]),
      );
      expect(byFeature.external_integrations.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'published', targetType: '有効な受信Webhook', count: 1 }),
        ]),
      );
      // 素材があっても数えない理由がある機能は空で、保存を止めない。
      expect(byFeature.media).toMatchObject({ blocking: false, items: [] });
    } finally {
      testDb.raw.close();
    }
  });

  it('版なしの機能・順序保存は400で拒否され、何も保存されない', async () => {
    const testDb = createTestD1();
    try {
      const first = await putFeatures(testDb, { expectedVersion: 0, features: { media: false } });
      expect(first.status).toBe(200);

      // 版なしの逐次保存は途中失敗で部分反映になるため受け付けない。
      // 断るだけにせず、次に送るべき版を機械可読な形で返す。
      const legacy = await putFeatures(testDb, { features: { scenarios: false } });
      expect(legacy.status).toBe(400);
      expect(legacy.body).toMatchObject({
        success: false,
        code: 'EXPECTED_VERSION_REQUIRED',
        data: { currentVersion: 1 },
      });

      // 実効値も版も変わっていない。
      const loaded = await app().request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: testDb.db, ...ENV },
      );
      expect(await loaded.json()).toMatchObject({
        success: true,
        data: { version: 1, features: { scenarios: true, media: false } },
      });
    } finally {
      testDb.raw.close();
    }
  });

  it('版なし拒否で返した版をそのまま添えれば1往復で保存できる', async () => {
    const testDb = createTestD1();
    try {
      expect((await putFeatures(testDb, { expectedVersion: 0, features: { media: false } })).status)
        .toBe(200);
      const rejected = await putFeatures(testDb, { features: { scenarios: false } });
      expect(rejected.status).toBe(400);
      const saved = await putFeatures(testDb, {
        expectedVersion: rejected.body.data.currentVersion,
        features: { scenarios: false },
      });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ success: true, data: { version: 2 } });
    } finally {
      testDb.raw.close();
    }
  });

  it('影響集計は対象ごとに上限なしの1回読取で、件数も同じ全IDから数える', async () => {
    const testDb = createTestD1();
    try {
      const values = Array.from({ length: 150 }, (_, index) => {
        const id = `b-${String(index).padStart(4, '0')}`;
        return `('${id}', '予約配信', 'text', '本文', 'all', 'scheduled', 'account-1')`;
      }).join(',\n');
      testDb.raw.exec(
        `INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
         VALUES ${values};`,
      );

      // 影響集計が実際に投げたSQLを記録する。
      const executed: string[] = [];
      const spyDb = new Proxy(testDb.db, {
        get(target, prop, receiver) {
          if (prop === 'prepare') {
            return (sql: string) => {
              executed.push(sql);
              return target.prepare(sql);
            };
          }
          return Reflect.get(target, prop, receiver) as unknown;
        },
      }) as D1Database;

      const response = await app().request(
        '/api/settings/features/impact?account_id=account-1',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedVersion: 0, features: { broadcasts: false } }),
        },
        { DB: spyDb, ...ENV },
      );
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, any>;
      const scheduled = (body.data.impacts[0].items as Array<{ targetType: string; count: number; ids: string[]; truncated: boolean }>)
        .find((item) => item.targetType === '予約済みの配信')!;
      // 件数は全件。応答IDは上限までで、欠けていることが分かる。
      expect(scheduled.count).toBe(150);
      expect(scheduled.ids).toHaveLength(100);
      expect(scheduled.truncated).toBe(true);

      // 数え先ごとの読取は1回だけ。COUNT(*)の別読取も、IDのLIMITも無い。
      const scheduledReads = executed.filter((sql) => sql.includes("b.status = 'scheduled'"));
      expect(scheduledReads).toHaveLength(1);
      expect(scheduledReads[0]).not.toMatch(/COUNT\(\*\)/);
      expect(scheduledReads[0]).not.toMatch(/\bLIMIT\b/);
    } finally {
      testDb.raw.close();
    }
  });

  it('一括設定・カタログ・トークン消費は一括で反映され、失敗時は部分反映しない', async () => {
    const testDb = createTestD1();
    try {
      seedLiveWork(testDb);
      const impact = await postImpact(testDb, { expectedVersion: 0, features: { broadcasts: false } });
      const token = impact.body.data.impactToken as string;

      // 機能オフと専用カタログを同時に保存する。
      const saved = await putFeatures(testDb, {
        expectedVersion: 0,
        features: { broadcasts: false },
        catalog: ['nen_campaigns'],
        impactToken: token,
      });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ success: true, data: { version: 1 } });

      const loaded = await app().request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: testDb.db, ...ENV },
      );
      expect(await loaded.json()).toMatchObject({
        success: true,
        data: {
          version: 1,
          features: { broadcasts: false },
          specializedFeatureKeys: ['nen_campaigns'],
        },
      });

      // 版が古い保存は全体が409で、一括設定もカタログも変わらない。
      const stale = await putFeatures(testDb, {
        expectedVersion: 0,
        features: { media: false },
        catalog: ['photo_review'],
      });
      expect(stale.status).toBe(409);
      const reread = await app().request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: testDb.db, ...ENV },
      );
      expect(await reread.json()).toMatchObject({
        success: true,
        data: {
          version: 1,
          features: { broadcasts: false, media: true },
          specializedFeatureKeys: ['nen_campaigns'],
        },
      });
    } finally {
      testDb.raw.close();
    }
  });

  it('件数が同じでも対象が入れ替わったら保存できない', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.exec(`
        INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
        VALUES ('b-old', '古い予約', 'text', '本文', 'all', 'scheduled', 'account-1');
      `);
      const impact = await postImpact(testDb, { expectedVersion: 0, features: { broadcasts: false } });
      expect(impact.body.data.impacts[0].items[0]).toMatchObject({ count: 1 });
      expect(impact.body.data.impacts[0].items[0].ids).toEqual(['b-old']);
      const token = impact.body.data.impactToken as string;

      // 同数のまま対象を入れ替える。
      testDb.raw.exec(`
        DELETE FROM broadcasts WHERE id = 'b-old';
        INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
        VALUES ('b-new', '新しい予約', 'text', '本文', 'all', 'scheduled', 'account-1');
      `);

      const saved = await putFeatures(testDb, {
        expectedVersion: 0,
        features: { broadcasts: false },
        impactToken: token,
      });
      expect(saved.status).toBe(409);
      expect(saved.body.code).toBe('IMPACT_CONFIRMATION_REQUIRED');
      expect(saved.body.data.impacts[0].items[0]).toMatchObject({ count: 1, ids: ['b-new'] });
    } finally {
      testDb.raw.close();
    }
  });

  it('101件目以降の入れ替えも全ID照合で検出する', async () => {
    const testDb = createTestD1();
    try {
      const values = Array.from(
        { length: 105 },
        (_, index) => {
          const id = `b-${String(index + 1).padStart(3, '0')}`;
          return `('${id}', '予約${id}', 'text', '本文', 'all', 'scheduled', 'account-1')`;
        },
      ).join(',');
      testDb.raw.exec(`
        INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
        VALUES ${values};
      `);
      const impact = await postImpact(testDb, { expectedVersion: 0, features: { broadcasts: false } });
      expect(impact.status).toBe(200);
      const item = impact.body.data.impacts[0].items[0];
      // 応答に載るのは先頭100件だけだが、件数は105件。
      expect(item).toMatchObject({ count: 105, truncated: true });
      expect(item.ids).toHaveLength(100);
      expect(item.ids[0]).toBe('b-001');
      // 照合用の全IDは応答に出さない。
      expect(item.fingerprintIds).toBeUndefined();
      const token = impact.body.data.impactToken as string;

      // 応答に載らない101件目以降を同数で入れ替える。
      testDb.raw.exec(`
        DELETE FROM broadcasts WHERE id = 'b-105';
        INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
        VALUES ('b-106', '新しい予約', 'text', '本文', 'all', 'scheduled', 'account-1');
      `);

      const saved = await putFeatures(testDb, {
        expectedVersion: 0,
        features: { broadcasts: false },
        impactToken: token,
      });
      expect(saved.status).toBe(409);
      expect(saved.body.code).toBe('IMPACT_CONFIRMATION_REQUIRED');
    } finally {
      testDb.raw.close();
    }
  });

  it('追加した数え先が実テーブルで正しく数えられる', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.exec(`
        INSERT INTO tracked_links (id, name, original_url, is_active, line_account_id)
        VALUES ('tl-1', '計測', 'https://example.com', 1, 'account-1'),
               ('tl-off', '停止', 'https://example.com', 0, 'account-1');
        INSERT INTO entry_routes (id, ref_code, name, is_active, line_account_id)
        VALUES ('er-1', 'abc', '流入', 1, 'account-1');
        INSERT INTO nen_photo_submissions
          (id, friend_id, pet_id, r2_key, image_url, content_type, caption, status, awarded_points,
           line_account_id, public_pet_name, review_notification_status, review_version,
           created_at, updated_at)
        VALUES ('ps-1', 'f-1', 'p-1', 'k', 'https://example.com/a.png', 'image/png', 'かわいい',
           'pending', 0, 'account-1', 1, 'not_required', 1,
           '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00');
        INSERT INTO media (id, kind, filename, mime_type, size_bytes, r2_key, line_account_id)
        VALUES ('m-1', 'image', 'a.png', 'image/png', 10, 'k1', 'account-1');
        INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
        VALUES ('m-1', 'broadcast', 'b-1', '2026-09-01T00:00:00+09:00');
        INSERT INTO field_migration_runs
          (id, tenant_id, line_account_id, source_field_id, target_field_id, source_version, target_version,
           preview_token_hash, preview_snapshot_hash, preview_expires_at, status, usage_targets_json,
           total_count, convertible_count, review_count, invalid_count, processed_count, succeeded_count,
           failed_count, created_by, created_at, updated_at)
        VALUES ('fm-1', 'tenant-a', 'account-1', 'sf', 'tf', 1, 1, 'h1', 'h2',
           '2099-01-01T00:00:00+09:00', 'running', '[]', 10, 8, 1, 1, 0, 0, 0, 'staff-1',
           '2026-09-01T00:00:00+09:00', '2026-09-01T00:00:00+09:00');
        INSERT INTO reminders (id, name, is_active, line_account_id, deleted_at)
        VALUES ('r-on', '有効', 1, 'account-1', NULL),
               ('r-off', '無効', 0, 'account-1', NULL),
               ('r-deleted', '削除済み', 1, 'account-1', '2026-09-01T00:00:00+09:00');
      `);
      const { status, body } = await postImpact(testDb, {
        expectedVersion: 0,
        features: {
          inflow_tracking: false, photo_review: false, media: false,
          friend_fields: false, reminders: false,
        },
      });
      expect(status).toBe(200);
      const byFeature = Object.fromEntries(
        (body.data.impacts as Array<{ feature: string; items: Array<{ targetType: string; count: number; ids: string[] }> }>)
          .map((impact) => [impact.feature, impact.items]),
      );
      expect(byFeature.inflow_tracking).toEqual(expect.arrayContaining([
        expect.objectContaining({ targetType: '公開中の計測リンク', count: 1, ids: ['tl-1'] }),
        expect.objectContaining({ targetType: '公開中の流入経路', count: 1, ids: ['er-1'] }),
      ]));
      expect(byFeature.photo_review).toEqual([
        expect.objectContaining({ targetType: '審査待ちの写真', count: 1, ids: ['ps-1'] }),
      ]);
      expect(byFeature.media).toEqual([
        expect.objectContaining({ targetType: '素材への利用参照', count: 1 }),
      ]);
      expect(byFeature.friend_fields).toEqual([
        expect.objectContaining({ targetType: '実行中の属性移行', count: 1, ids: ['fm-1'] }),
      ]);
      // 有効な設定だけ数え、無効と削除済みは数えない。
      expect(byFeature.reminders).toEqual([
        expect.objectContaining({ targetType: '有効なリマインド設定', count: 1, ids: ['r-on'] }),
      ]);
    } finally {
      testDb.raw.close();
    }
  });

  it('持ち主不明のフォームとウェビナーは影響に加算しない', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.exec(`
        INSERT INTO forms (id, name, fields, is_active) VALUES ('f-unassigned', '未割当', '[]', 1);
        INSERT INTO forms (id, name, fields, is_active) VALUES ('f-mine', '自社', '[]', 1);
        INSERT INTO form_accounts (form_id, line_account_id) VALUES ('f-mine', 'account-1');
        INSERT INTO webinars (id, account_id, title, slug, status, created_at, updated_at)
        VALUES ('w-null', NULL, '未割当', 'slug-null', 'active', '2026-09-01', '2026-09-01'),
               ('w-mine', 'account-1', '自社', 'slug-mine', 'active', '2026-09-01', '2026-09-01');
      `);
      // ウェビナーは既定オフのため、先に有効化してオフ遷移を作る。
      const enabled = await putFeatures(testDb, { expectedVersion: 0, features: { webinars: true } });
      expect(enabled.status).toBe(200);
      const { status, body } = await postImpact(testDb, {
        expectedVersion: 1,
        features: { forms: false, webinars: false },
      });
      expect(status).toBe(200);
      const byFeature = Object.fromEntries(
        (body.data.impacts as Array<{ feature: string; items: Array<{ targetType: string; count: number; ids: string[] }> }>)
          .map((impact) => [impact.feature, impact.items]),
      );
      expect(byFeature.forms).toEqual([
        expect.objectContaining({ targetType: '公開中の回答フォーム', count: 1, ids: ['f-mine'] }),
      ]);
      expect(byFeature.webinars).toEqual([
        expect.objectContaining({ targetType: '公開中のウェビナー', count: 1, ids: ['w-mine'] }),
      ]);
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
      expect(stale.body.data.impacts[0].items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'scheduled', targetType: '予約済みの配信', count: 2 }),
        ]),
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
