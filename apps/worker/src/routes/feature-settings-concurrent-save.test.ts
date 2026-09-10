/*
 * #643 再差戻し(4回目)の実行試験: 同時保存の敗者は1行も書かない。
 *
 * 一括設定のCASだけを条件にしていた頃は、負けた側でも専用カタログの
 * 上書きと確認トークンの削除だけがcommitされ、409を返しながら別の変更が
 * 効いていた。ここでは読み取りとcommitの間に別の管理者の保存を実際に
 * 割り込ませ、敗者側の副作用が1つも残らないことを確かめる。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

const access = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: access.canAccess,
}));

const { featureSettings } = await import('./feature-settings.js');

const ENV = { RESTAURANT_TEST_ENABLED: 'true' } as Record<string, string>;
const CATALOG_KEY = 'feature.specialized.catalog';
const CONFIRM_KEY = 'feature.off_confirm';

function app() {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: 'owner',
      name: 'Owner',
      role: 'owner',
      readOnly: false,
      tenantId: DEFAULT_TENANT_ID,
    });
    await next();
  });
  instance.route('/', featureSettings);
  return instance;
}

async function call(db: D1Database, path: string, init?: RequestInit) {
  const response = await app().request(path, init, { DB: db, ...ENV });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

const putFeatures = (db: D1Database, body: unknown) => call(
  db,
  '/api/settings/features?account_id=account-1',
  { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
);

const postImpact = (db: D1Database, body: unknown) => call(
  db,
  '/api/settings/features/impact?account_id=account-1',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
);

function seedLiveWork(testDb: SqliteD1) {
  testDb.raw.exec(`
    INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id)
    VALUES ('b-scheduled', '予約配信', 'text', '本文', 'all', 'scheduled', 'account-1');
  `);
}

function setting(testDb: SqliteD1, key: string) {
  return testDb.raw.prepare(
    'SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?',
  ).get('account-1', key) as { value: string } | undefined;
}

/**
 * 読み取りとcommitの間に、別の管理者の保存を1度だけ割り込ませる。
 * 割り込みは同じ経路(PUT)で行い、実際に版を1つ進める。
 */
function racingDb(testDb: SqliteD1, intrude: () => Promise<void>): D1Database {
  const base = testDb.db;
  const batch = base.batch.bind(base);
  let done = false;
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          if (!done) {
            done = true;
            await intrude();
          }
          return batch(statements);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as D1Database;
}

beforeEach(() => {
  vi.clearAllMocks();
  access.canAccess.mockResolvedValue(true);
});

describe('同時保存の原子性', () => {
  it('CASに負けた保存はカタログもトークンも残さず409を返す', async () => {
    const testDb = createTestD1();
    try {
      seedLiveWork(testDb);
      const impact = await postImpact(testDb.db, { expectedVersion: 0, features: { broadcasts: false } });
      expect(impact.status).toBe(200);
      const token = impact.body.data.impactToken as string;
      expect(typeof token).toBe('string');
      const confirmBefore = setting(testDb, CONFIRM_KEY);
      expect(confirmBefore).toBeDefined();

      // 敗者の保存: 一括設定・専用カタログ・トークン消費を一度に書く。
      // batch直前に別の管理者が版を1つ進める。
      const db = racingDb(testDb, async () => {
        const winner = await putFeatures(testDb.db, {
          expectedVersion: 0,
          features: { scenarios: false },
        });
        expect(winner.status).toBe(200);
      });
      const loser = await putFeatures(db, {
        expectedVersion: 0,
        features: { broadcasts: false },
        catalog: ['nen_campaigns'],
        impactToken: token,
      });

      expect(loser.status).toBe(409);
      expect(loser.body).toMatchObject({ success: false, data: { currentVersion: 1 } });

      // 勝者の変更だけが残る。敗者の機能変更は入っていない。
      const loaded = await call(testDb.db, '/api/settings/features?account_id=account-1');
      expect(loaded.body).toMatchObject({
        success: true,
        data: { version: 1, features: { scenarios: false, broadcasts: true } },
      });
      // 敗者の副作用は1つも残らない。カタログは書かれず、トークンも消えない。
      expect(setting(testDb, CATALOG_KEY)).toBeUndefined();
      expect(setting(testDb, CONFIRM_KEY)?.value).toBe(confirmBefore?.value);
    } finally {
      testDb.raw.close();
    }
  });

  it('負けた後に取り直せば、同じ操作がそのまま最後まで通る', async () => {
    const testDb = createTestD1();
    try {
      seedLiveWork(testDb);
      const first = await postImpact(testDb.db, { expectedVersion: 0, features: { broadcasts: false } });
      const db = racingDb(testDb, async () => {
        await putFeatures(testDb.db, { expectedVersion: 0, features: { scenarios: false } });
      });
      const loser = await putFeatures(db, {
        expectedVersion: 0,
        features: { broadcasts: false },
        catalog: ['nen_campaigns'],
        impactToken: first.body.data.impactToken as string,
      });
      expect(loser.status).toBe(409);

      // 最新の版で確認し直し、そのトークンで保存する。
      const retry = await postImpact(testDb.db, { expectedVersion: 1, features: { broadcasts: false } });
      expect(retry.status).toBe(200);
      const saved = await putFeatures(testDb.db, {
        expectedVersion: 1,
        features: { broadcasts: false },
        catalog: ['nen_campaigns'],
        impactToken: retry.body.data.impactToken as string,
      });
      expect(saved.status).toBe(200);
      expect(saved.body).toMatchObject({ success: true, data: { version: 2 } });

      const loaded = await call(testDb.db, '/api/settings/features?account_id=account-1');
      expect(loaded.body).toMatchObject({
        success: true,
        data: {
          version: 2,
          features: { broadcasts: false, scenarios: false },
          specializedFeatureKeys: ['nen_campaigns'],
        },
      });
      // 使い切りのトークンは消費されている。
      expect(setting(testDb, CONFIRM_KEY)).toBeUndefined();
    } finally {
      testDb.raw.close();
    }
  });

  it('既にあるカタログ行も勝った側だけが上書きする', async () => {
    const testDb = createTestD1();
    try {
      const first = await putFeatures(testDb.db, {
        expectedVersion: 0,
        features: { media: false },
        catalog: ['nen_campaigns'],
      });
      expect(first.status).toBe(200);
      expect(setting(testDb, CATALOG_KEY)?.value).toBe('["nen_campaigns"]');

      // 上書き経路(既存行あり)でも、負けた側は元の値を残す。
      const db = racingDb(testDb, async () => {
        await putFeatures(testDb.db, { expectedVersion: 1, features: { scenarios: false } });
      });
      const loser = await putFeatures(db, {
        expectedVersion: 1,
        features: { forms: false },
        catalog: ['photo_review'],
      });
      expect(loser.status).toBe(409);
      expect(setting(testDb, CATALOG_KEY)?.value).toBe('["nen_campaigns"]');

      // 取り直せば上書きできる。
      const retry = await putFeatures(testDb.db, {
        expectedVersion: 2,
        features: { forms: false },
        catalog: ['photo_review'],
      });
      expect(retry.status).toBe(200);
      expect(setting(testDb, CATALOG_KEY)?.value).toBe('["photo_review"]');
    } finally {
      testDb.raw.close();
    }
  });

  it('初回保存(版なし行)でも、負けた側はカタログを書かない', async () => {
    const testDb = createTestD1();
    try {
      const db = racingDb(testDb, async () => {
        const winner = await putFeatures(testDb.db, {
          expectedVersion: 0,
          features: { scenarios: false },
        });
        expect(winner.status).toBe(200);
      });
      const loser = await putFeatures(db, {
        expectedVersion: 0,
        features: { media: false },
        catalog: ['photo_review'],
      });
      expect(loser.status).toBe(409);
      expect(setting(testDb, CATALOG_KEY)).toBeUndefined();

      const loaded = await call(testDb.db, '/api/settings/features?account_id=account-1');
      expect(loaded.body).toMatchObject({
        success: true,
        data: { version: 1, features: { scenarios: false, media: true } },
      });
    } finally {
      testDb.raw.close();
    }
  });
});
