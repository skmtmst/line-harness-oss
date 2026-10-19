import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { storeFeatureInitialization } from '@line-crm/db/src/store-feature-initialization.js';
import { initializeAccountStyle, saveProfile } from '../services/style-setup.js';
import { styles } from './styles.js';
import type { Env } from '../worker-env.js';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: async (_db: unknown, _staff: unknown, ids: string[]) =>
    ids.every((id) => id === 'a'),
}));

let sql: ReturnType<typeof createTestD1>, app: Hono<Env>;
let actor: Env['Variables']['staff'];
const configured = (value: boolean) => ({ mode: 'configured', value });
const rows = () => sql.raw.prepare('SELECT * FROM rt_store_feature_flags ORDER BY store_id,feature').all();
const save = (expectedVersion: number, answers: Record<string, unknown> = {}, style = 'standard') =>
  app.request('/api/dashboard/style?account_id=a', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion, answers, style }),
  }, { DB: sql.db } as Env['Bindings']);
function addStore(id = 'store', account = 'a', organization = 'org') {
  sql.raw.prepare(`INSERT INTO rt_stores(id,organization_id,line_account_id,name,code)
    VALUES(?,?,?,'店舗',?)`).run(id, organization, account, id);
}
function storeChoice(enabled: number) {
  sql.raw.prepare(`INSERT INTO rt_store_feature_flags(store_id,feature,enabled,config_json,updated_by,version,created_at,updated_at)
    VALUES('store','reservation',?,'{"storeChoice":true}','store-owner',7,1,2)
    ON CONFLICT(store_id,feature) DO UPDATE SET enabled=excluded.enabled,
      config_json=excluded.config_json,updated_by=excluded.updated_by,version=excluded.version,updated_at=excluded.updated_at`).run(enabled);
}
beforeEach(async () => {
  sql = createTestD1({ foreignKeys: true });
  sql.raw.exec(`INSERT INTO tenants(id,name) VALUES('t','本部'),('foreign','別本部');
    INSERT INTO line_accounts(id,tenant_id,channel_id,name,channel_access_token,channel_secret)
      VALUES('a','t','a','A','fixture','fixture'),('b','t','b','B','fixture','fixture'),
      ('c','foreign','c','C','fixture','fixture');
    INSERT INTO rt_organizations(id,account_id,tenant_id,name)
      VALUES('org','a','t','本部'),('foreign-org','c','foreign','別本部');
    INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','店長','owner','fixture','t');`);
  await initializeAccountStyle(sql.db, 'a', 't', 'owner');
  addStore();
  actor = { id: 'owner', name: '店長', role: 'owner', tenantId: 't', readOnly: false } as Env['Variables']['staff'];
  app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', actor); await next(); });
  app.route('/', styles);
});
afterEach(() => { vi.restoreAllMocks(); sql.raw.close(); });

test.each([true, false])('first explicit boolean %s initializes only reservation/coupon', async (value) => {
  expect((await save(1, { booking: configured(value), coupons: configured(!value), payment: configured(true) })).status).toBe(200);
  expect(rows()).toEqual([
    expect.objectContaining({ store_id: 'store', feature: 'coupon', enabled: Number(!value), version: 1, updated_by: 'owner' }),
    expect.objectContaining({ store_id: 'store', feature: 'reservation', enabled: Number(value), version: 1, updated_by: 'owner' }),
  ]);
});

test.each([{}, { mode: 'later', value: true }, { mode: 'manual', value: true },
  { mode: 'configured' }, { mode: 'configured', value: 'true' }])('non-boolean/deferred %j leaves initialization available', async (answer) => {
  expect((await save(1, Object.keys(answer).length ? { booking: answer, coupons: answer } : {})).status).toBe(200);
  expect(rows()).toEqual([]);
  expect((await save(2, { booking: configured(false), coupons: configured(true) })).status).toBe(200);
  expect(rows()).toHaveLength(2);
});

test.each([0, 1])('existing store value %s and metadata win over repeated answers and style changes', async (enabled) => {
  storeChoice(enabled);
  const before = rows();
  expect((await save(1, { booking: configured(!enabled) })).status).toBe(200);
  expect((await save(2, { booking: configured(!!enabled) }, 'ec')).status).toBe(200);
  expect((await save(3, { booking: configured(!enabled) })).status).toBe(200);
  expect(rows()).toEqual(before);
});

test('store changes after initialization survive resave with zero updates', async () => {
  expect((await save(1, { booking: configured(true) })).status).toBe(200);
  storeChoice(0);
  const before = rows();
  expect((await save(2, { booking: configured(true) })).status).toBe(200);
  expect(rows()).toEqual(before);
});

test('simultaneous profile saves commit one version and initialize once', async () => {
  const responses = await Promise.all([
    save(1, { booking: configured(true), coupons: configured(false) }),
    save(1, { booking: configured(false), coupons: configured(true) }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = (await responses.find((r) => r.status === 200)!.json()) as { data: { answers: Record<string, { value: boolean }> } };
  expect(rows()).toEqual([
    expect.objectContaining({ feature: 'coupon', enabled: Number(winner.data.answers.coupons.value), version: 1 }),
    expect.objectContaining({ feature: 'reservation', enabled: Number(winner.data.answers.booking.value), version: 1 }),
  ]);
});

test('store write racing before profile batch wins', async () => {
  const batch = sql.db.batch.bind(sql.db);
  vi.spyOn(sql.db, 'batch').mockImplementationOnce(async (statements) => {
    storeChoice(0);
    return batch(statements);
  });
  expect((await save(1, { booking: configured(true) })).status).toBe(200);
  expect(rows()).toEqual([expect.objectContaining({ enabled: 0, version: 7, updated_by: 'store-owner' })]);
});

test('failure after flag insert rolls back profile, flags and audit; same version can retry', async () => {
  sql.raw.exec(`CREATE TRIGGER fail_style_audit BEFORE INSERT ON style_change_logs
    BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`);
  expect((await save(1, { booking: configured(true) })).status).toBe(503);
  expect(rows()).toEqual([]);
  expect(sql.raw.prepare('SELECT version FROM account_styles WHERE line_account_id=?').get('a')).toEqual({ version: 1 });
  sql.raw.exec('DROP TRIGGER fail_style_audit');
  expect((await save(1, { booking: configured(false) })).status).toBe(200);
  expect(rows()).toEqual([expect.objectContaining({ enabled: 0, version: 1 })]);
});

test('missing store is not guessed; later creation can initialize in its own atomic batch', async () => {
  sql.raw.exec("UPDATE rt_stores SET line_account_id=NULL WHERE id='store'");
  expect((await save(1, { booking: configured(false), coupons: configured(true) })).status).toBe(200);
  expect(rows()).toEqual([]);
  await sql.db.batch([
    sql.db.prepare(`INSERT INTO rt_stores(id,organization_id,line_account_id,name,code)
      VALUES('later','org','a','後から作る店','later')`),
    storeFeatureInitialization(sql.db, 'a', 't', 'owner', 123, 'later'),
  ]);
  const before = rows();
  expect(before).toHaveLength(2);
  await sql.db.batch([storeFeatureInitialization(sql.db, 'a', 't', 'owner', 456, 'later')]);
  expect(rows()).toEqual(before);
  expect((await save(2, { booking: configured(true), coupons: configured(false) })).status).toBe(200);
  expect(rows()).toEqual(before);
});

test('answers saved before store creation initialize on next profile save, existing off still wins', async () => {
  sql.raw.exec("UPDATE rt_stores SET line_account_id=NULL WHERE id='store'");
  expect((await save(1, { booking: configured(true), coupons: configured(false) })).status).toBe(200);
  sql.raw.exec("UPDATE rt_stores SET line_account_id='a' WHERE id='store'");
  storeChoice(0);
  expect((await save(2)).status).toBe(200);
  expect(rows()).toEqual([
    expect.objectContaining({ feature: 'coupon', enabled: 0, version: 1 }),
    expect.objectContaining({ feature: 'reservation', enabled: 0, version: 7 }),
  ]);
});

test('other accounts, foreign organization, unknown store and wrong tenant cannot receive answers', async () => {
  addStore('other', 'b'); addStore('foreign', 'c', 'foreign-org');
  expect((await save(1, { booking: configured(true) })).status).toBe(200);
  expect(rows()).toEqual([expect.objectContaining({ store_id: 'store' })]);
  sql.raw.exec('DELETE FROM rt_store_feature_flags');
  for (const [tenant, store] of [['foreign', 'store'], ['t', 'other'], ['t', 'missing']]) {
    await sql.db.batch([storeFeatureInitialization(sql.db, 'a', tenant!, 'owner', 1, store)]);
  }
  sql.raw.exec("UPDATE rt_stores SET organization_id='foreign-org' WHERE id='store'");
  await sql.db.batch([storeFeatureInitialization(sql.db, 'a', 't', 'owner', 1)]);
  expect(rows()).toEqual([]);
});

test('legacy organization must name this account; archived stores are not initialized', async () => {
  sql.raw.exec("UPDATE rt_organizations SET tenant_id=NULL WHERE id='org'");
  expect((await save(1, { booking: configured(true) })).status).toBe(200);
  expect(rows()).toHaveLength(1);
  sql.raw.exec("DELETE FROM rt_store_feature_flags; UPDATE rt_organizations SET account_id='b' WHERE id='org'");
  expect((await save(2)).status).toBe(200);
  expect(rows()).toEqual([]);
  sql.raw.exec("UPDATE rt_organizations SET account_id='a' WHERE id='org'; UPDATE rt_stores SET status='archived' WHERE id='store'");
  expect((await save(3)).status).toBe(200);
  expect(rows()).toEqual([]);
});

test('ownership changed while preparing save cannot copy answers into a foreign organization', async () => {
  const batch = sql.db.batch.bind(sql.db);
  vi.spyOn(sql.db, 'batch').mockImplementationOnce(async (statements) => {
    sql.raw.exec("UPDATE rt_stores SET organization_id='foreign-org' WHERE id='store'");
    return batch(statements);
  });
  expect((await save(1, { booking: configured(true) })).status).toBe(200);
  expect(rows()).toEqual([]);
});

test('failed later-store creation batch leaves no partial flags or completion marker', async () => {
  sql.raw.exec("UPDATE rt_stores SET line_account_id=NULL WHERE id='store'");
  expect((await save(1, { booking: configured(true), coupons: configured(false) })).status).toBe(200);
  await expect(sql.db.batch([
    sql.db.prepare(`INSERT INTO rt_stores(id,organization_id,line_account_id,name,code)
      VALUES('later','org','a','後から作る店','later')`),
    storeFeatureInitialization(sql.db, 'a', 't', 'owner', 123, 'later'),
    sql.db.prepare("SELECT json('fixture failure')"),
  ])).rejects.toThrow();
  expect(rows()).toEqual([]);
  expect(sql.raw.prepare("SELECT id FROM rt_stores WHERE id='later'").get()).toBeUndefined();
});

test.each(['read-only', 'staff', 'other-account'])('%s cannot save profile or initialize store flags', async (kind) => {
  if (kind === 'read-only') actor.readOnly = true;
  if (kind === 'staff') actor.role = 'staff';
  const r = kind === 'other-account'
    ? await app.request('/api/dashboard/style?account_id=b', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 0, answers: { booking: configured(true) } }) }, { DB: sql.db } as Env['Bindings'])
    : await save(1, { booking: configured(true) });
  expect(r.status).toBe(kind === 'other-account' ? 404 : 403);
  expect(rows()).toEqual([]);
});

test('registration initialization and reads leave flags absent and keep the standard non-reservation starter samples', async () => {
  expect(rows()).toEqual([]);
  expect(sql.raw.prepare("SELECT COUNT(*) n FROM templates WHERE line_account_id='a'").get()).toEqual({ n: 5 });
  expect((await app.request('/api/dashboard/style?account_id=a', {}, { DB: sql.db } as Env['Bindings'])).status).toBe(200);
  expect(rows()).toEqual([]);
  await expect(saveProfile(sql.db, 'a', 't', 'owner', { expectedVersion: 0 })).rejects.toMatchObject({ code: 'version_conflict' });
});
