/*
 * N-441/N-444: 並び順の完全順序検査と、保存理由・前後差分の監査。
 *
 * 画面が組み立てる「完全な並び」と同じ約束をサーバーでも検査する:
 * 知らない区分・知らない項目・別区分の項目・欠落・余分は400。
 * 保存する要求には変更理由が必須で、成功した保存だけが、保存と同じ
 * batchで監査行を残す。CASに負けた要求は監査も残さない。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  DEFAULT_TENANT_ID,
  MENU_SECTION_LABELS,
  expectedMenuItemOrder,
} from '@line-crm/shared';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { featureSettings, NEN_SPECIALIZED_FEATURES } from './feature-settings.js';

const access = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: access.canAccess,
}));

const ENV = { RESTAURANT_TEST_ENABLED: 'true' } as Record<string, string>;
const CATALOG_KEY = 'feature.specialized.catalog';
const BUNDLE_KEY = 'feature.settings_bundle_v1';

function app(role: 'owner' | 'admin' = 'owner') {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: `staff-${role}`,
      name: role,
      role,
      readOnly: false,
      tenantId: DEFAULT_TENANT_ID,
    });
    await next();
  });
  instance.route('/', featureSettings);
  return instance;
}

function call(db: D1Database, path: string, init?: RequestInit) {
  return app().request(path, init, { DB: db, ...ENV });
}

function put(db: D1Database, body: unknown, headers?: Record<string, string>) {
  return call(db, '/api/settings/features?account_id=account-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** 既定の専用カタログ（4機能全部）での完全な並び。 */
const FULL_ORDER = expectedMenuItemOrder(new Set(NEN_SPECIALIZED_FEATURES));

function audits(testDb: SqliteD1) {
  return testDb.raw.prepare(
    `SELECT * FROM audit_events WHERE action = 'feature_settings.save' ORDER BY created_at, id`,
  ).all() as Record<string, unknown>[];
}

beforeEach(() => {
  vi.clearAllMocks();
  access.canAccess.mockResolvedValue(true);
});

describe('sidebarItemOrder の完全順序', () => {
  it('知らない区分・知らない項目・別区分の項目・欠落・余分を400にする', async () => {
    const testDb = createTestD1();
    try {
      const cases: Record<string, unknown>[] = [
        // 知らない区分
        { 'no-such-section': ['dashboard'] },
        // 知らない項目
        { ...FULL_ORDER, delivery: [...FULL_ORDER.delivery.slice(0, -1), 'no-such-item'] },
        // 別区分の項目（settings の staff を delivery へ）
        { ...FULL_ORDER, delivery: [...FULL_ORDER.delivery.slice(0, -1), 'staff'] },
        // 区分の欠落（delivery が無い）
        Object.fromEntries(Object.entries(FULL_ORDER).filter(([key]) => key !== 'delivery')),
        // 項目の欠落（delivery の末尾が無い）
        { ...FULL_ORDER, delivery: FULL_ORDER.delivery.slice(0, -1) },
        // 項目の余分（delivery に2回同じ項目は重複だが、別項目を追加）
        { ...FULL_ORDER, delivery: [...FULL_ORDER.delivery, 'staff'] },
      ];
      for (const sidebarItemOrder of cases) {
        const response = await put(testDb.db, {
          expectedVersion: 0,
          reason: 'テスト',
          sidebarItemOrder,
        });
        expect(response.status).toBe(400);
      }
      // 何も保存されていない
      expect(testDb.raw.prepare(
        'SELECT COUNT(*) AS count FROM account_settings WHERE line_account_id = ?',
      ).get('account-1')).toEqual({ count: 0 });
    } finally {
      testDb.raw.close();
    }
  });

  it('完全な並びは200で保存され、項目だけの入れ替えも受け付ける', async () => {
    const testDb = createTestD1();
    try {
      const reordered = {
        ...FULL_ORDER,
        delivery: [...FULL_ORDER.delivery].reverse(),
      };
      const response = await put(testDb.db, {
        expectedVersion: 0,
        reason: '配信を上に',
        sidebarItemOrder: reordered,
      });
      expect(response.status).toBe(200);

      const loaded = await call(testDb.db, '/api/settings/features?account_id=account-1');
      const body = await loaded.json() as { data: { sidebarItemOrder: Record<string, string[]> } };
      expect(body.data.sidebarItemOrder.delivery).toEqual([...FULL_ORDER.delivery].reverse());
    } finally {
      testDb.raw.close();
    }
  });

  it('専用カタログに無い項目は過不足として400にする', async () => {
    const testDb = createTestD1();
    try {
      // 専用カタログを nen_campaigns だけに保存
      const catalogSave = await put(testDb.db, {
        catalog: ['nen_campaigns'],
        reason: 'テスト',
      });
      expect(catalogSave.status).toBe(200);

      // 専用区分の正解は nen-campaigns のみ。photo-review を含めると400。
      const order = expectedMenuItemOrder(new Set(['nen_campaigns']));
      const withExtra = {
        ...order,
        specialized: ['nen-campaigns', 'photo-review'],
      };
      const bad = await put(testDb.db, {
        expectedVersion: 0,
        reason: 'テスト',
        sidebarItemOrder: withExtra,
      });
      expect(bad.status).toBe(400);

      // 正しい顔ぶれなら通る
      const good = await put(testDb.db, {
        expectedVersion: 0,
        reason: 'テスト',
        sidebarItemOrder: order,
      });
      expect(good.status).toBe(200);
    } finally {
      testDb.raw.close();
    }
  });
});

describe('sidebarOrder の完全順序', () => {
  it('知らない区分名・一部だけの並びを400にする', async () => {
    const testDb = createTestD1();
    try {
      for (const sidebarOrder of [
        ['配信', '未知の区分', '設定'],
        MENU_SECTION_LABELS.slice(1), // 先頭区分の欠落
        [...MENU_SECTION_LABELS, '余分な区分'],
      ]) {
        const response = await put(testDb.db, {
          expectedVersion: 0,
          reason: 'テスト',
          sidebarOrder,
        });
        expect(response.status).toBe(400);
      }
    } finally {
      testDb.raw.close();
    }
  });

  it('全区分の完全な並び替えは受け付ける', async () => {
    const testDb = createTestD1();
    try {
      const reordered = [...MENU_SECTION_LABELS].reverse();
      const response = await put(testDb.db, {
        expectedVersion: 0,
        reason: 'テスト',
        sidebarOrder: reordered,
      });
      expect(response.status).toBe(200);

      const loaded = await call(testDb.db, '/api/settings/features?account_id=account-1');
      const body = await loaded.json() as { data: { sidebarOrder: string[] } };
      expect(body.data.sidebarOrder).toEqual(reordered);
    } finally {
      testDb.raw.close();
    }
  });
});

describe('変更理由と監査', () => {
  it('理由なし・空白だけの保存は400で、何も書かない', async () => {
    const testDb = createTestD1();
    try {
      for (const reason of [undefined, '', '   ']) {
        const response = await put(testDb.db, {
          expectedVersion: 0,
          ...(reason === undefined ? {} : { reason }),
          features: { scenarios: false },
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          success: false,
          code: 'FEATURE_SETTINGS_REASON_REQUIRED',
        });
      }
      expect(testDb.raw.prepare(
        'SELECT COUNT(*) AS count FROM account_settings WHERE line_account_id = ?',
      ).get('account-1')).toEqual({ count: 0 });
      expect(audits(testDb)).toHaveLength(0);
    } finally {
      testDb.raw.close();
    }
  });

  it('成功した保存は操作者・前後version・前後値・理由・IP/UAを監査へ残す', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.prepare(`INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
        VALUES ('account-1', 'ch-1', 'account-1', 'token', 'secret', ?)`).run(DEFAULT_TENANT_ID);

      const response = await put(testDb.db, {
        expectedVersion: 0,
        reason: '使わない配信機能を止める',
        features: { broadcasts: false },
        sidebarItemOrder: FULL_ORDER,
      }, {
        'cf-connecting-ip': '203.0.113.10',
        'user-agent': 'Mozilla/5.0 (Macintosh) Safari',
        'x-request-id': 'req-test-1',
      });
      expect(response.status).toBe(200);

      const rows = audits(testDb);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.actor_principal_id).toBe('staff-owner');
      expect(row.actor_role).toBe('owner');
      expect(row.line_account_id).toBe('account-1');
      expect(row.reason).toBe('使わない配信機能を止める');
      expect(row.request_trace_id).toBe('req-test-1');
      expect(row.ip_prefix).toBe('203.0.113.***');
      expect(row.device_family).toBe('mac');
      expect(row.result).toBe('success');

      const before = JSON.parse(row.before_json as string) as Record<string, unknown>;
      const after = JSON.parse(row.after_json as string) as Record<string, unknown>;
      expect(before.version).toBe(0);
      expect((before.features as Record<string, boolean>).broadcasts).toBe(true);
      expect(after.version).toBe(1);
      expect((after.features as Record<string, boolean>).broadcasts).toBe(false);
    } finally {
      testDb.raw.close();
    }
  });

  it('409で負けた保存は監査を残さず、勝ち直した保存だけが残る', async () => {
    const testDb = createTestD1();
    try {
      const first = await put(testDb.db, {
        expectedVersion: 0,
        reason: '最初の保存',
        features: { scenarios: false },
      });
      expect(first.status).toBe(200);

      const stale = await put(testDb.db, {
        expectedVersion: 0,
        reason: '古い版での保存',
        features: { broadcasts: false },
      });
      expect(stale.status).toBe(409);

      const rows = audits(testDb);
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0].after_json as string)).toMatchObject({ version: 1 });
    } finally {
      testDb.raw.close();
    }
  });

  it('専用カタログだけの変更も理由必須で、保存と一緒に監査へ残る', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.prepare(`INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
        VALUES ('account-1', 'ch-1', 'account-1', 'token', 'secret', ?)`).run(DEFAULT_TENANT_ID);

      const noReason = await put(testDb.db, { catalog: ['nen_campaigns'] });
      expect(noReason.status).toBe(400);

      const saved = await put(testDb.db, {
        catalog: ['nen_campaigns'],
        reason: '専用機能を絞る',
      });
      expect(saved.status).toBe(200);

      const rows = audits(testDb);
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0].after_json as string)).toMatchObject({
        catalog: ['nen_campaigns'],
      });
      expect(rows[0].reason).toBe('専用機能を絞る');
    } finally {
      testDb.raw.close();
    }
  });
});
