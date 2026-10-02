import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';

const access = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: access.canAccess,
}));

const { featureSettings } = await import('./feature-settings.js');

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner-1',
      name: 'owner',
      role: 'owner',
      readOnly: false,
      tenantId: 'tenant-a',
    });
    await next();
  });
  instance.route('/', featureSettings);
  return instance;
}

/**
 * D1 往復回数の観測用ラッパー(#633)。
 * 全画面共通の機能設定APIは、改善前は旧保存の読取だけで30往復超だった。
 * 構造的な削減を「prepareの発行回数」で固定する（体感msではなくクエリ数）。
 */
function countingDb(db: D1Database): { db: D1Database; count: () => number } {
  let calls = 0;
  const proxy = {
    ...db,
    prepare: (sql: string) => {
      calls += 1;
      return db.prepare(sql);
    },
  } as D1Database;
  return { db: proxy, count: () => calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  access.canAccess.mockResolvedValue(true);
});

describe('機能設定APIのD1往復回数(#633)', () => {
  it('一括設定ありの管理GETは小さい往復数で返す', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.prepare(
        `INSERT INTO account_settings (id, line_account_id, key, value)
         VALUES ('bundle-1', 'account-1', 'feature.settings_bundle_v1', ?)`,
      ).run(JSON.stringify({
        version: 3,
        data: {
          features: { scenarios: false },
          sidebarOrder: null,
          sidebarItemOrder: null,
        },
      }));
      const counting = countingDb(testDb.db);
      const response = await app().request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: counting.db, RESTAURANT_TEST_ENABLED: 'false' },
      );
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { version: number } };
      expect(body.data.version).toBe(3);
      // 設定束 + 契約結合読取 + 親子/専用カタログ = 4往復。連鎖した個別読取ではない。
      expect(counting.count()).toBeLessThanOrEqual(6);
    } finally {
      testDb.raw.close();
    }
  });

  it('旧 `feature.<キー>` だけのアカウントも30往復超ではなく1往復で束ねる', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.prepare(
        `INSERT INTO account_settings (id, line_account_id, key, value)
         VALUES ('legacy-1', 'account-1', 'feature.scenarios', '{"enabled":false}')`,
      ).run();
      const counting = countingDb(testDb.db);
      const response = await app().request(
        '/api/settings/features?account_id=account-1',
        {},
        { DB: counting.db, RESTAURANT_TEST_ENABLED: 'false' },
      );
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { features: Record<string, boolean> } };
      expect(body.data.features.scenarios).toBe(false);
      // 改善前は旧キー30本超を個別に読んでいた。束読み後は片手で足りる。
      expect(counting.count()).toBeLessThanOrEqual(8);
    } finally {
      testDb.raw.close();
    }
  });

  it('staff向けvisibilityも旧保存の個別読取を往復1回へ束ねる', async () => {
    const testDb = createTestD1();
    try {
      testDb.raw.prepare(
        `INSERT INTO account_settings (id, line_account_id, key, value)
         VALUES ('legacy-2', 'account-1', 'feature.scenarios', '{"enabled":false}')`,
      ).run();
      const counting = countingDb(testDb.db);
      const response = await app().request(
        '/api/settings/features/visibility?account_id=account-1',
        {},
        { DB: counting.db, RESTAURANT_TEST_ENABLED: 'false' },
      );
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { features: Record<string, boolean> } };
      expect(body.data.features.scenarios).toBe(false);
      expect(counting.count()).toBeLessThanOrEqual(8);
    } finally {
      testDb.raw.close();
    }
  });
});
