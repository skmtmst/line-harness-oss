import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

let fixture: SqliteD1;
beforeEach(() => {
  fixture = createTestD1({ foreignKeys: true, loginPolicy: 'off' });
  fixture.raw.exec(`INSERT INTO tenants(id,name) VALUES('fixture-tenant','Fixture');
    INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id)
      VALUES('fixture-hq','Fixture HQ','fixture-hq-channel','fixture-secret','fixture-token','fixture-tenant'),
            ('fixture-store','Fixture store','fixture-store-channel','fixture-secret','fixture-token','fixture-tenant'),
            ('fixture-sibling','Fixture sibling','fixture-sibling-channel','fixture-secret','fixture-token','fixture-tenant');
    UPDATE line_accounts SET parent_line_account_id='fixture-hq' WHERE id IN ('fixture-store','fixture-sibling');
    INSERT INTO staff_members(id,name,role,api_key,tenant_id,assigned_line_account_id,can_access_descendant_accounts)
      VALUES('fixture-admin','Fixture admin','admin','fixture-folder-admin-key','fixture-tenant','fixture-hq',1);`);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external requests are disabled in this fixture'); }));
});
afterEach(() => { vi.unstubAllGlobals(); fixture.raw.close(); });

function create(color?: string | null, key = 'fixture-folder-request-key-0001') {
  return app.request('http://localhost/api/friend-add-rules/folders', {
    method: 'POST', headers: { Authorization: 'Bearer fixture-folder-admin-key', 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ accountId: 'fixture-store', name: '挨拶', color }),
  }, { DB: fixture.db, DEPLOY_ENV: 'test' } as Env['Bindings']);
}

it.each([undefined, null, '#3b82f6'])('管理者が統括の配下の店舗で色%sのフォルダを作り、同じ鍵の再試行を重ねない', async (color) => {
  const created = await create(color);
  const body = await created.json() as { data?: { id: string; name: string; color: string | null } };
  expect(created.status, JSON.stringify(body)).toBe(201);
  expect(body.data).toMatchObject({ name: '挨拶', color: color ?? null });
  const replay = await create(color);
  expect(replay.status).toBe(200);
  expect((await replay.json() as typeof body).data?.id).toBe(body.data?.id);
  expect(fixture.raw.prepare('SELECT count(*) AS n FROM friend_add_rule_folders').get()).toEqual({ n: 1 });
  expect(fixture.raw.prepare("SELECT count(*) AS n FROM folders WHERE kind='friend_add_rule' AND account_id='fixture-store'").get()).toEqual({ n: 1 });
  expect(fetch).not.toHaveBeenCalled();
});

it('同じ店舗の別種類に同名があっても作成でき、同じ種類だけは409で理由を返す', async () => {
  fixture.raw.prepare("INSERT INTO folders(id,kind,account_id,name) VALUES('scenario-folder','scenario','fixture-store',?)").run('挨拶');
  const created = await create('#16a34a');
  expect(created.status, await created.clone().text()).toBe(201);
  expect(fixture.raw.prepare("SELECT kind FROM folders WHERE account_id='fixture-store' AND name=? ORDER BY kind").all('挨拶'))
    .toEqual([{ kind: 'friend_add_rule' }, { kind: 'scenario' }]);
  const duplicate = await create('#16a34a', 'fixture-different-request-key-0002');
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toMatchObject({ error: { code: 'DUPLICATE_FOLDER_NAME', message: '同じ名前のフォルダがあります' } });
  expect(fixture.raw.prepare('SELECT count(*) AS n FROM friend_add_rule_folders').get()).toEqual({ n: 1 });
});

it('担当店舗を明示された管理者も下の店舗に作成でき、担当外へは書き込まない', async () => {
  fixture.raw.exec("UPDATE staff_members SET account_scope='accounts' WHERE id='fixture-admin'; INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES('fixture-admin','fixture-store','now'),('fixture-admin','fixture-sibling','now');");
  const created = await create(null);
  expect(created.status, await created.clone().text()).toBe(201);
  fixture.raw.exec("DELETE FROM staff_account_scopes WHERE line_account_id='fixture-store';");
  const denied = await create(null, 'fixture-no-access-request-key-0003');
  expect(denied.status).toBe(403);
  expect(fixture.raw.prepare('SELECT count(*) AS n FROM friend_add_rule_folders').get()).toEqual({ n: 1 });
});
