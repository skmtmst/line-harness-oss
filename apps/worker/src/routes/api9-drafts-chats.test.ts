import { Hono } from 'hono';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  scenarioDrafts,
  purgeExpiredScenarioDrafts,
} from './scenario-drafts.js';
import { chatMessages } from './chat-messages.js';
let db: SqliteD1;
async function read(r: Response) {
  return (await r.json()) as {
    data: import('@line-crm/shared').ScenarioDraft &
      import('@line-crm/shared').ConversationSearchResult &
      import('@line-crm/shared').ConversationMessagePage;
  };
}
const admin: AuthenticatedStaff = {
  id: 'admin',
  name: '管理者',
  role: 'admin',
  readOnly: false,
  tenantId: 't1',
  permissionKeys: [],
};
function app(staff = admin) {
  const a = new Hono<Env>();
  a.use('*', async (c, next) => {
    c.env = { DB: db.db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  a.route('/', scenarioDrafts);
  a.route('/', chatMessages);
  return a;
}
const save = (
  content: unknown,
  expectedVersion: string | 0 = 0,
  staff = admin,
  key = 'new',
) =>
  app(staff).request(`/api/scenario-drafts/${key}?lineAccountId=a1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, expectedVersion }),
  });
beforeEach(() => {
  db = createTestD1();
  db.raw.exec(
    `INSERT INTO tenants(id,name) VALUES('t1','1'),('t2','2'); INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES('a1','1','1','','','t1'),('a2','2','2','','','t2'); INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('f1','U1','a1','1'),('f2','U2','a2','2');`,
  );
});
afterEach(() => db.raw.close());
describe('シナリオ下書き', () => {
  it('別の行に保存し、競合で内容を失わない', async () => {
    expect((await save({ name: '途中' })).status).toBe(201);
    const first = await read(
      await app().request('/api/scenario-drafts/new?lineAccountId=a1'),
    );
    expect(first.data.version).toMatch(/^[a-f0-9-]{36}$/);
    const v1 = first.data.version;
    expect(
      Date.parse(first.data.expiresAt) - Date.parse(first.data.updatedAt),
    ).toBe(30 * 86400000);
    const responses = await Promise.all([
      save({ name: '先' }, v1),
      save({ name: '後' }, v1),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM scenarios').get()).toEqual({
      n: 0,
    });
    expect((await save({ name: '古' }, v1)).status).toBe(409);
    expect(
      (
        await app().request('/api/scenario-drafts/new?lineAccountId=a1', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedVersion: v1 }),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await app().request('/api/scenario-drafts/new?lineAccountId=a1', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedVersion: (
              await read(
                await app().request(
                  '/api/scenario-drafts/new?lineAccountId=a1',
                ),
              )
            ).data.version,
          }),
        })
      ).status,
    ).toBe(200);
    expect((await save({ name: '作り直し' })).status).toBe(201);
    expect((await save({ name: '古いタブ' }, v1)).status).toBe(409);
  });
  it('別アカウント・閲覧のみ・無権限・期限切れを拒否する', async () => {
    await save({ name: '途中' });
    const readonly = { ...admin, readOnly: true };
    expect((await save({}, 0, readonly)).status).toBe(403);
    expect(
      (await app(readonly).request('/api/scenario-drafts/new?lineAccountId=a1'))
        .status,
    ).toBe(200);
    expect(
      (await app().request('/api/scenario-drafts/new?lineAccountId=a2')).status,
    ).toBe(404);
    expect(
      (await save({}, 0, { ...admin, role: 'staff', permissionKeys: [] }))
        .status,
    ).toBe(403);
    db.raw.exec(
      "UPDATE scenario_edit_drafts SET expires_at='2000-01-01T00:00:00.000Z'",
    );
    expect(
      (await app().request('/api/scenario-drafts/new?lineAccountId=a1')).status,
    ).toBe(404);
    expect(
      (await save({}, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).status,
    ).toBe(409);
    expect(await purgeExpiredScenarioDrafts(db.db)).toBe(1);
  });
  it('サイズと既存の通の所属を確かめる', async () => {
    expect((await save([])).status).toBe(400);
    expect((await save({ x: 'あ'.repeat(100000) })).status).toBe(413);
    const r = await app().request(
      '/api/scenario-drafts/step?lineAccountId=a1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: {},
          expectedVersion: 0,
          scenarioId: 'other',
          stepId: 'step',
        }),
      },
    );
    expect(r.status).toBe(404);
  });
});
function message(id: string, content: string, other = '') {
  db.raw
    .prepare(
      `INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at,delivery_type,unsent_at) VALUES(?,'f1','incoming','text',?,?,?,?)`,
    )
    .run(
      id,
      content,
      `2026-10-07T00:${id.slice(-2)}:00Z`,
      other === 'test' ? 'test' : null,
      other === 'unsent' ? '2026-10-07' : null,
    );
}
describe('会話の検索と位置', () => {
  it('表記をそろえ、取り消し・テストの本文を出さず前後と件数を返す', async () => {
    message('m00', '前');
    message('m01', 'ＬＩＮＥの予約');
    message('m02', 'lineで相談');
    message('m03', '後');
    message('m04', 'LINE秘密', 'unsent');
    message('m05', 'LINE試験', 'test');
    const r = await app().request(
      '/api/chats/f1/messages/search?q=LiNe&limit=1',
    );
    expect(r.status).toBe(200);
    const { data } = await read(r);
    expect(data.total).toBe(2);
    expect(data.nextOffset).toBe(1);
    expect(data.hits[0]).toMatchObject({
      id: 'm01',
      before: { id: 'm00' },
      after: { id: 'm02' },
    });
    const around = await app().request(
      `/api/chats/f1/messages?direction=around&cursorId=m01&cursorAt=${encodeURIComponent(data.hits[0].at)}&limit=3`,
    );
    expect((await read(around)).data).toMatchObject({
      total: 5,
      messages: [{ id: 'm00' }, { id: 'm01' }, { id: 'm02' }],
      afterCursor: { id: 'm02' },
    });
    const page = await read(
      await app().request('/api/chats/f1/messages?limit=10'),
    );
    expect(
      page.data.messages.find((m: { id: string }) => m.id === 'm04')!.content,
    ).toBe('');
  });
  it('所属・権限・検索語・偽カーソルを拒否する', async () => {
    expect(
      (await app().request('/api/chats/f2/messages/search?q=a')).status,
    ).toBe(404);
    expect(
      (
        await app({ ...admin, role: 'staff', permissionKeys: [] }).request(
          '/api/chats/f1/messages/search?q=a',
        )
      ).status,
    ).toBe(403);
    expect(
      (await app().request('/api/chats/f1/messages/search?q=')).status,
    ).toBe(400);
    expect(
      (
        await app().request(
          '/api/chats/f1/messages?cursorId=foreign&cursorAt=2026-10-07',
        )
      ).status,
    ).toBe(404);
  });
  it('500件を越える会話も全部数える', async () => {
    const insert = db.raw.prepare(
      "INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES(?,'f1','incoming','text','Ｘ','2026-10-07')",
    );
    for (let i = 0; i < 501; i++) insert.run(String(i).padStart(4, '0'));
    const { data } = await read(
      await app().request('/api/chats/f1/messages/search?q=x&offset=500'),
    );
    expect(data.total).toBe(501);
    expect(data.hits).toHaveLength(1);
    expect(data.hits[0].before?.id).toBe('0499');
  });
});
