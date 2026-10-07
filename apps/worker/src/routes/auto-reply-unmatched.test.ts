import { Hono } from 'hono';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { Env } from '../index.js';
import type { LineClient } from '@line-crm/line-sdk';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
const mocks = vi.hoisted(() => ({
  finish: vi.fn(),
  log: vi.fn(async () => 'log'),
}));
vi.mock('@line-crm/db', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  markAutoReplyEvaluationFinished: mocks.finish,
}));
vi.mock('../services/event-bus.js', () => ({ logOutgoingMessage: mocks.log }));
import { autoReplyUnmatched } from './auto-reply-unmatched.js';
import { replyToUnmatchedLine } from '../services/auto-reply-unmatched.js';
let db: SqliteD1;
const admin: AuthenticatedStaff = {
  id: 'staff',
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
  a.route('/', autoReplyUnmatched);
  return a;
}
const save = (message: string | null, expectedVersion: number, staff = admin) =>
  app(staff).request('/api/auto-replies/unmatched-settings?lineAccountId=a1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, expectedVersion }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  db = createTestD1();
  db.raw.exec(
    "INSERT INTO tenants(id,name) VALUES('t1','1'),('t2','2'); INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a1','1','1','','','t1'),('a2','2','2','','','t2');",
  );
});
afterEach(() => db.raw.close());
it('未設定は何も送らず、アカウントの返事を設定したときだけ返す', async () => {
  const reply = vi.fn(async () => ({ requestId: 'req', data: {} })),
    input = {
      lineAccountId: 'a1',
      friendId: 'f',
      evaluationId: 'e',
      replyToken: 'mock_reply',
      client: { replyMessageWithRequestId: reply } as unknown as LineClient,
    };
  expect(await replyToUnmatchedLine(db.db, input)).toBeNull();
  expect(reply).not.toHaveBeenCalled();
  expect((await save('お問い合わせを受け付けました', 0)).status).toBe(200);
  expect(await replyToUnmatchedLine(db.db, input)).toEqual({
    matched: true,
    replyTokenConsumed: true,
  });
  expect(reply).toHaveBeenCalledExactlyOnceWith('mock_reply', [
    { type: 'text', text: 'お問い合わせを受け付けました' },
  ]);
  expect((await save(null, 1)).status).toBe(200);
  expect(await replyToUnmatchedLine(db.db, input)).toBeNull();
});
it('版・所属・閲覧のみ・長さの境界を守る', async () => {
  await save('受け付けました', 0);
  expect((await save('古い変更', 0)).status).toBe(409);
  expect((await save('変更', 1, { ...admin, readOnly: true })).status).toBe(
    403,
  );
  expect(
    (await save('変更', 1, { ...admin, role: 'staff', permissionKeys: [] }))
      .status,
  ).toBe(403);
  expect(
    (
      await app().request(
        '/api/auto-replies/unmatched-settings?lineAccountId=a2',
      )
    ).status,
  ).toBe(404);
  expect((await save('x'.repeat(5001), 1)).status).toBe(400);
  const [a, b] = await Promise.all([save('先', 1), save('後', 1)]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
});
it('受理後に履歴保存が失敗しても、送信失敗として戻さない', async () => {
  await save('返事', 0);
  mocks.log.mockRejectedValueOnce(new Error('mock log failure'));
  const reply = vi.fn(async () => ({ requestId: 'req', data: {} }));
  expect(
    await replyToUnmatchedLine(db.db, {
      lineAccountId: 'a1',
      friendId: 'f',
      evaluationId: 'e',
      replyToken: 'mock',
      client: { replyMessageWithRequestId: reply } as unknown as LineClient,
    }),
  ).toEqual({ matched: true, replyTokenConsumed: true });
  expect(mocks.finish).toHaveBeenCalledWith(
    db.db,
    expect.objectContaining({
      status: 'completed',
      replyStatus: 'accepted',
    }),
  );
  expect(mocks.finish).not.toHaveBeenCalledWith(
    db.db,
    expect.objectContaining({ status: 'reply_failed' }),
  );
});

it('消えた共通情報の差し込みは空にせず送信を止める', async () => {
  await save('受付: {{var.missing}}', 0);
  const reply = vi.fn();
  expect(
    await replyToUnmatchedLine(db.db, {
      lineAccountId: 'a1',
      friendId: 'f',
      evaluationId: 'e',
      replyToken: 'mock',
      client: { replyMessageWithRequestId: reply } as unknown as LineClient,
    }),
  ).toEqual({ matched: true, replyTokenConsumed: false });
  expect(reply).not.toHaveBeenCalled();
  expect(mocks.finish).toHaveBeenCalledWith(
    db.db,
    expect.objectContaining({ status: 'reply_failed' }),
  );
});
