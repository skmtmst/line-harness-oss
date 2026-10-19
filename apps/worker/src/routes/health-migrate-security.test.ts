import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../worker-env.js';
import { health } from './health.js';

describe('S09 legacy migration boundaries', () => {
  let fixture: SqliteD1;
  beforeEach(() => {
    fixture = createTestD1();
    const { raw } = fixture;
    raw.prepare("INSERT OR IGNORE INTO tenants(id,name,status) VALUES (?, 'Synthetic default', 'active')").run(DEFAULT_TENANT_ID);
    raw.prepare("INSERT INTO tenants(id,name,status) VALUES ('other-tenant', 'Synthetic other', 'active')").run();
    for (const [id, tenant, active] of [
      ['source', DEFAULT_TENANT_ID, 1], ['target', DEFAULT_TENANT_ID, 1],
      ['foreign', 'other-tenant', 1], ['stopped', DEFAULT_TENANT_ID, 0],
    ]) raw.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id,is_active) VALUES (?,?,?,\'fixture\',\'fixture\',?,?)').run(id,id,id,tenant,active);
    for (const [id, account] of [['source-friend','source'], ['other-friend','foreign'], ['target-friend','target']])
      raw.prepare('INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES (?,?,?,1)').run(id,id,account);
  });
  afterEach(() => fixture.raw.close());

  function request(source: string, target: string, tenantId = DEFAULT_TENANT_ID) {
    const app = new Hono<Env>();
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'env-owner', role: 'owner', name: 'Synthetic operator', readOnly: false, tenantId });
      await next();
    });
    app.route('/', health);
    return app.request(`/api/accounts/${source}/migrate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ toAccountId: target }),
    }, { DB: fixture.db } as Env['Bindings']);
  }

  it.each([['source','foreign'], ['foreign','source'], ['source','stopped'], ['stopped','target'], ['source','missing']])(
    'rejects inaccessible or inactive endpoint %s -> %s before writing', async (source, target) => {
      expect((await request(source, target)).status).toBe(404);
      expect(fixture.raw.prepare('SELECT COUNT(*) AS n FROM account_migrations').get()).toEqual({ n: 0 });
    },
  );
  it('counts following friends only at the source account', async () => {
    const response = await request('source','target');
    expect(response.status).toBe(201);
    expect((await response.json() as any).data.totalCount).toBe(1);
  });
  it('cannot move into another tenant even with its own owner', async () => {
    expect((await request('foreign','source','other-tenant')).status).toBe(404);
  });
});
