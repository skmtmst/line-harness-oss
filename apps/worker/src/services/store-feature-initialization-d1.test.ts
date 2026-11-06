import { Miniflare } from 'miniflare';
import { expect, test } from 'vitest';
import { storeFeatureInitialization } from '@line-crm/db/src/store-feature-initialization.js';

test('real D1 atomically checks the profile version, saves answers and initializes flags once', async () => {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
  try {
    const db = await mf.getD1Database('DB') as unknown as D1Database;
    await db.batch([
      'CREATE TABLE line_accounts(id TEXT PRIMARY KEY,tenant_id TEXT,is_active INTEGER,archived_at TEXT)',
      'CREATE TABLE account_styles(line_account_id TEXT PRIMARY KEY,answers_json TEXT,version INTEGER)',
      'CREATE TABLE rt_organizations(id TEXT PRIMARY KEY,account_id TEXT,tenant_id TEXT,status TEXT)',
      'CREATE TABLE rt_stores(id TEXT PRIMARY KEY,line_account_id TEXT,organization_id TEXT,status TEXT)',
      `CREATE TABLE rt_store_feature_flags(store_id TEXT REFERENCES rt_stores(id),feature TEXT,enabled INTEGER CHECK(enabled IN(0,1)),config_json TEXT,updated_by TEXT,version INTEGER DEFAULT 1,created_at INTEGER,updated_at INTEGER,PRIMARY KEY(store_id,feature))`,
      "INSERT INTO line_accounts VALUES('a','t',1,NULL)",
      "INSERT INTO account_styles VALUES('a','{}',1)",
      "INSERT INTO rt_organizations VALUES('o','a','t','test')",
      "INSERT INTO rt_stores VALUES('s','a','o','active')",
    ].map((query) => db.prepare(query)));
    const batch = (expected: number, booking: boolean, fail = false) => db.batch([
      db.prepare(`SELECT json(CASE WHEN (SELECT version FROM account_styles WHERE line_account_id='a')=? THEN '{}' ELSE 'VERSION_CONFLICT' END)`).bind(expected),
      db.prepare("UPDATE account_styles SET answers_json=?,version=version+1 WHERE line_account_id='a'")
        .bind(JSON.stringify({ booking: { mode: 'configured', value: booking }, coupons: { mode: 'configured', value: false } })),
      storeFeatureInitialization(db, 'a', 't', 'owner', 123),
      db.prepare(fail ? "SELECT json('fixture failure')" : 'SELECT 1'),
    ]);
    await expect(batch(1, true, true)).rejects.toThrow();
    expect((await db.prepare('SELECT * FROM rt_store_feature_flags').all()).results).toEqual([]);
    expect(await db.prepare('SELECT version FROM account_styles').first()).toEqual({ version: 1 });
    await batch(1, false);
    const initialized = (await db.prepare('SELECT * FROM rt_store_feature_flags ORDER BY feature').all()).results;
    expect(initialized).toEqual([
      expect.objectContaining({ feature: 'coupon', enabled: 0, version: 1 }),
      expect.objectContaining({ feature: 'reservation', enabled: 0, version: 1 }),
    ]);
    await batch(2, true);
    await expect(batch(2, true)).rejects.toThrow();
    expect((await db.prepare('SELECT * FROM rt_store_feature_flags ORDER BY feature').all()).results).toEqual(initialized);
    expect(await db.prepare('SELECT version FROM account_styles').first()).toEqual({ version: 3 });
  } finally { await mf.dispose(); }
}, 30000);
