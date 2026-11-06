import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID, emptyLayout, type FormBookingConfig, type FormInputBlock } from '@line-crm/shared';


import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { authMiddleware } from '../middleware/auth.js';

vi.mock('../features/friends/friend-tag-attach.js', () => ({ attachTagAndFireSideEffects: vi.fn() }));
vi.mock('../services/event-bus.js', () => ({ fireEvent: vi.fn(), logOutgoingMessage: vi.fn() }));
const { forms } = await import('./forms.js');
let sqlite: SqliteD1;
let app: Hono<Env>;

function layout(options: Partial<FormBookingConfig> = {}) {
  const value = emptyLayout();
  value.sections[0].blocks = [{ id: 'booking-block', kind: 'input', type: 'booking', name: 'visit', label: '予約',
    booking: { menuId: 'menu-a', staffId: null, daysAhead: 14, ...options } }];
  return value;
}
function request(accountId: string, method = 'GET', body?: unknown, key = 'owner-key') {
  return app.request(`/api/forms/form-a?account_id=${accountId}`, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { DB: sqlite.db });
}
beforeEach(() => {
  sqlite = createTestD1({ loginPolicy: 'off', foreignKeys: true });
  sqlite.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
    VALUES('account-a','channel-a','店舗A','t','s'),('account-b','channel-b','店舗B','t','s');
    INSERT INTO forms(id,name,fields,is_active) VALUES('form-a','予約フォーム','[]',0);
    INSERT INTO form_accounts(form_id,line_account_id) VALUES('form-a','account-a')`);
  sqlite.raw.prepare(`INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope)
    VALUES('owner-a','店長','owner','owner-key',?,'all'),('viewer-a','閲覧','staff','viewer-key',?,'all')`)
    .run(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID);
  sqlite.raw.exec(`UPDATE staff_members SET view_permission_keys='["/form-submissions"]' WHERE id='viewer-a'`);
  app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', forms);
});
afterEach(() => sqlite.raw.close());

describe('フォームの予約つまみの保存契約', () => {
  it.each([[true, false], [false, true], [true, true], [false, false]])(
    '選択=%s・承認=%sを保存して再読込し、古い保存は上書きしない', async (allowMenuSelection, requireApproval) => {
      const options = { allowMenuSelection, requireApproval };
      const saved = await request('account-a', 'PUT', { layout: layout(options), expectedContentRevision: 1 });
      expect(saved.status).toBe(200);
      const version = await saved.json() as { data: { contentRevision: number } };
      expect(version.data.contentRevision).toBe(2);
      const read = await request('account-a');
      expect(read.status).toBe(200);
      const body = await read.json() as { data: { layout: ReturnType<typeof layout> } };
      expect((body.data.layout.sections[0].blocks[0] as FormInputBlock).booking).toEqual({
        menuId: 'menu-a', staffId: null, daysAhead: 14, ...options,
      });
      expect((await request('account-a', 'PUT', {
        layout: layout({ allowMenuSelection: !allowMenuSelection, requireApproval: !requireApproval }), expectedContentRevision: 1,
      })).status).toBe(409);
      const stored = JSON.parse((sqlite.raw.prepare("SELECT layout FROM forms WHERE id='form-a'").get() as { layout: string }).layout);
      expect(stored.sections[0].blocks[0].booking).toMatchObject(options);
    },
  );
  it.each(['allowMenuSelection', 'requireApproval'] as const)('%sの文字・数・nullを保存しない', async key => {
    for (const value of ['false', 1, null, [], {}]) {
      const response = await request('account-a', 'PUT', { layout: layout({ [key]: value } as never), expectedContentRevision: 1 });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ success: false, fields: { layout: expect.any(String) } });
    }
    expect(sqlite.raw.prepare("SELECT layout,content_revision FROM forms WHERE id='form-a'").get()).toEqual({ layout: null, content_revision: 1 });
  });
  it('別の店からは読めず保存もできない', async () => {
    expect((await request('account-b')).status).toBe(404);
    expect((await request('account-b', 'PUT', { layout: layout({ allowMenuSelection: true }), expectedContentRevision: 1 })).status).toBe(404);
  });
  it('つまみがない既存の予約設定も保存できる', async () => {
    expect((await request('account-a', 'PUT', { layout: layout(), expectedContentRevision: 1 })).status).toBe(200);
  });
  it('閲覧のみは保存を拒み、公開済みの値は下書きの変更で変わらない', async () => {
    const initial = { allowMenuSelection: false, requireApproval: true };
    const next = { allowMenuSelection: true, requireApproval: false };
    expect((await request('account-a', 'PUT', { layout: layout(initial), expectedContentRevision: 1 })).status).toBe(200);
    const published = await app.request('/api/forms/form-a/publish?account_id=account-a', {
      method: 'POST', headers: { Authorization: 'Bearer owner-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedContentRevision: 2 }),
    }, { DB: sqlite.db });
    expect(published.status).toBe(200);
    expect((await request('account-a', 'PUT', { layout: layout(next), expectedContentRevision: 2 }, 'viewer-key')).status).toBe(403);
    expect((await request('account-a', 'PUT', { layout: layout(next), expectedContentRevision: 2 })).status).toBe(200);
    const response = await app.request('/api/forms/form-a', {}, { DB: sqlite.db });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { layout: { sections: [{ blocks: [{ booking: initial }] }] } } });
    expect(await (await request('account-a')).json()).toMatchObject({ data: { layout: { sections: [{ blocks: [{ booking: next }] }] } } });
  });
});
