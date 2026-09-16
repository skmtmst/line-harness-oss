/*
 * 引用返信と送信予約(N-025)のルート対照。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）に実物の chats ルートを当て、
 * LINE clientだけを止める。
 *   - 引用元は同じfriend・同じLINEアカウント・未取消だけが通る
 *   - 無効な引用は404で、LINE呼び出し0回・保存0件
 *   - 引用元にquoteTokenがあれば送信メッセージへそのまま付く
 *   - 予約は未来時刻のみ・冪等キーで二重作成しない・scheduledだけ取消/変更できる
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

const pushMessage = vi.fn().mockResolvedValue({ sentMessages: [{}] });
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({ pushMessage })),
}));

const { chats } = await import('./chats.js');

let sqlite: SqliteD1;

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};

function app(staff: AuthenticatedStaff = owner) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: sqlite.db } as Env['Bindings'];
    c.set('staff', staff);
    await next();
  });
  instance.route('/', chats);
  return instance;
}

const KEY1 = '11111111-2222-4333-8444-555555555555';
const KEY2 = '22222222-2222-4333-8444-555555555555';
const KEY3 = '33333333-2222-4333-8444-555555555555';
const KEY4 = '44444444-2222-4333-8444-555555555555';
const KEY5 = '55555555-2222-4333-8444-555555555555';
const KEY6 = '66666666-2222-4333-8444-555555555555';
const KEY7 = '77777777-2222-4333-8444-555555555555';
const KEY8 = '88888888-2222-4333-8444-555555555555';
const KEY9 = '99999999-2222-4333-8444-555555555555';
const KEY10 = '10101010-2222-4333-8444-555555555555';

function postSend(body: unknown, key: string, chatId = 'fr-1') {
  return app().request(`/api/chats/${chatId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
}

function postSchedule(body: unknown, key: string | null, chatId = 'fr-1') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['Idempotency-Key'] = key;
  return app().request(`/api/chats/${chatId}/schedule`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function getScheduled(chatId = 'fr-1') {
  return app().request(`/api/chats/${chatId}/scheduled`);
}

function patchScheduled(scheduleId: string, body: unknown, chatId = 'fr-1') {
  return app().request(`/api/chats/${chatId}/scheduled/${scheduleId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteScheduled(scheduleId: string, chatId = 'fr-1') {
  return app().request(`/api/chats/${chatId}/scheduled/${scheduleId}`, { method: 'DELETE' });
}

function outbox(friendId = 'fr-1') {
  return sqlite.raw.prepare(
    `SELECT id, message_type, content, quoted_message_id FROM messages_log
      WHERE friend_id = ? AND direction = 'outgoing' ORDER BY created_at`,
  ).all(friendId) as Array<{ id: string; message_type: string; content: string; quoted_message_id: string | null }>;
}

function scheduledRows() {
  return sqlite.raw.prepare(`SELECT * FROM scheduled_chat_sends ORDER BY created_at`).all() as Array<Record<string, unknown>>;
}

function insertIncoming(id: string, friendId: string, accountId: string | null, overrides: Record<string, unknown> = {}) {
  sqlite.raw.prepare(
    `INSERT INTO messages_log
       (id, friend_id, direction, message_type, content, source, line_account_id, created_at, quote_token, unsent_at)
     VALUES (?, ?, 'incoming', 'text', ?, 'user', ?, '2026-01-01T00:00:00.000+09:00', ?, ?)`,
  ).run(
    id,
    friendId,
    overrides.content ?? `本文${id}`,
    accountId,
    'quoteToken' in overrides ? (overrides.quoteToken as string | null) : `QT-${id}`,
    'unsentAt' in overrides ? (overrides.unsentAt as string | null) : null,
  );
}

function seed() {
  const raw = sqlite.raw;
  raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
  for (const id of ['acc-1', 'acc-2']) {
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES (?, ?, ?, 'token', 'secret', 1, 'tenant-1')`,
    ).run(id, `channel-${id}`, id);
  }
  raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
     VALUES ('owner-1', 'オーナー', 'owner', 'key-owner', 'tenant-1', 'all', '[]')`,
  ).run();
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES ('fr-1', 'U-1', '利用者1', 'acc-1')`,
  ).run();
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES ('fr-2', 'U-2', '利用者2', 'acc-2')`,
  ).run();
  insertIncoming('m-in', 'fr-1', 'acc-1');
  insertIncoming('m-other-friend', 'fr-2', 'acc-2');
  insertIncoming('m-unsent', 'fr-1', 'acc-1', { unsentAt: '2026-01-01T01:00:00.000+09:00' });
  insertIncoming('m-no-token', 'fr-1', 'acc-1', { quoteToken: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  pushMessage.mockResolvedValue({ sentMessages: [{}] });
  sqlite = createTestD1();
  seed();
});

describe('引用返信(N-025)', () => {
  test('引用元を付けて送るとquoteTokenがLINEへ渡り、履歴に引用が残る', async () => {
    const res = await postSend({ content: '返信です', revision: 0, quotedMessageId: 'm-in' }, KEY1);
    expect(res.status).toBe(200);
    const [, messages] = pushMessage.mock.calls[0] as [string, Array<{ quoteToken?: string }>, string];
    expect(messages[0].quoteToken).toBe('QT-m-in');
    const logged = outbox();
    expect(logged).toHaveLength(1);
    expect(logged[0].quoted_message_id).toBe('m-in');
  });

  test('quoteTokenが無い引用元でも内部の引用として記録される', async () => {
    const res = await postSend({ content: '返信です', revision: 0, quotedMessageId: 'm-no-token' }, KEY2);
    expect(res.status).toBe(200);
    const [, messages] = pushMessage.mock.calls[0] as [string, Array<{ quoteToken?: string }>, string];
    expect(messages[0].quoteToken).toBeUndefined();
    expect(outbox()[0].quoted_message_id).toBe('m-no-token');
  });

  test('別friendのメッセージは引用できず、LINE呼び出し0回・保存0件', async () => {
    const res = await postSend({ content: '返信です', revision: 0, quotedMessageId: 'm-other-friend' }, KEY3);
    expect(res.status).toBe(404);
    expect(pushMessage).not.toHaveBeenCalled();
    expect(outbox('fr-1').filter((r) => r.message_type === 'text' && r.content === '返信です')).toHaveLength(0);
  });

  test('取消済みのメッセージは引用できない', async () => {
    const res = await postSend({ content: '返信です', revision: 0, quotedMessageId: 'm-unsent' }, KEY4);
    expect(res.status).toBe(404);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('存在しないメッセージは引用できない', async () => {
    const res = await postSend({ content: '返信です', revision: 0, quotedMessageId: 'm-missing' }, KEY5);
    expect(res.status).toBe(404);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('結合送信でも引用が先頭メッセージへ付き、履歴の先頭行に記録される', async () => {
    const res = await app().request('/api/chats/fr-1/send-combined', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': KEY6 },
      body: JSON.stringify({
        image: { originalContentUrl: 'https://x/o.jpg', previewImageUrl: 'https://x/p.jpg' },
        text: '写真つき返信',
        quotedMessageId: 'm-in',
      }),
    });
    expect(res.status).toBe(200);
    const [, messages] = pushMessage.mock.calls[0] as [string, Array<{ quoteToken?: string }>, string];
    expect(messages[0].quoteToken).toBe('QT-m-in');
    const logged = outbox('fr-1').filter((r) => r.id.startsWith(KEY6));
    expect(logged[0].quoted_message_id).toBe('m-in');
    expect(logged[1].quoted_message_id).toBeNull();
  });

  test('会話詳細は引用元の要約を返す', async () => {
    await postSend({ content: '引用つき返信', revision: 0, quotedMessageId: 'm-in' }, KEY7);
    const res = await app().request('/api/chats/fr-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { messages: Array<{ content: string; quoted: { id: string; content: string } | null }> };
    };
    const sent = body.data.messages.find((m) => m.content === '引用つき返信');
    expect(sent?.quoted?.id).toBe('m-in');
    expect(sent?.quoted?.content).toBe('本文m-in');
  });
});

describe('送信予約(N-025)', () => {
  const future = () => new Date(Date.now() + 60 * 60_000).toISOString();

  test('冪等キー無しは400', async () => {
    const res = await postSchedule({ content: 'あとで', scheduledAt: future() }, null);
    expect(res.status).toBe(400);
    expect(scheduledRows()).toHaveLength(0);
  });

  test('過去の日時は400で予約を作らない', async () => {
    const res = await postSchedule(
      { content: 'あとで', scheduledAt: new Date(Date.now() - 60_000).toISOString() },
      KEY1,
    );
    expect(res.status).toBe(400);
    expect(scheduledRows()).toHaveLength(0);
  });

  test('未来の日時で予約が作られ、一覧に出る', async () => {
    const res = await postSchedule({ content: '明日の朝に', scheduledAt: future() }, KEY1);
    expect(res.status).toBe(200);
    const rows = scheduledRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('scheduled');
    expect(rows[0].friend_id).toBe('fr-1');

    const list = await getScheduled();
    const body = (await list.json()) as { data: { scheduled: Array<{ id: string; content: string }> } };
    expect(body.data.scheduled).toHaveLength(1);
    expect(body.data.scheduled[0].content).toBe('明日の朝に');
  });

  test('同じ冪等キーの再送は新しい予約を作らない', async () => {
    const first = await postSchedule({ content: 'あとで', scheduledAt: future() }, KEY1);
    expect(first.status).toBe(200);
    const second = await postSchedule({ content: 'あとで', scheduledAt: future() }, KEY1);
    expect(second.status).toBe(200);
    const body = (await second.json()) as { data: { replayed: boolean } };
    expect(body.data.replayed).toBe(true);
    expect(scheduledRows()).toHaveLength(1);
  });

  test('無効な引用元では予約を作らない', async () => {
    const res = await postSchedule(
      { content: 'あとで', scheduledAt: future(), quotedMessageId: 'm-other-friend' },
      KEY1,
    );
    expect(res.status).toBe(404);
    expect(scheduledRows()).toHaveLength(0);
  });

  test('予約はscheduledの間だけ取消・変更でき、取消後は409', async () => {
    const created = await postSchedule({ content: 'あとで', scheduledAt: future() }, KEY1);
    const { data } = (await created.json()) as { data: { id: string } };

    const patchRes = await patchScheduled(data.id, { content: '内容を変える' });
    expect(patchRes.status).toBe(200);
    expect(scheduledRows()[0].content).toBe('内容を変える');

    const del = await deleteScheduled(data.id);
    expect(del.status).toBe(200);
    expect(scheduledRows()[0].status).toBe('cancelled');

    // 取消済みの予約はもう触れない。
    const again = await deleteScheduled(data.id);
    expect(again.status).toBe(409);
  });

  test('別friendの予約IDは404（存在を漏らさない）', async () => {
    const created = await postSchedule({ content: 'あとで', scheduledAt: future() }, KEY1);
    const { data } = (await created.json()) as { data: { id: string } };
    const res = await deleteScheduled(data.id, 'fr-2');
    expect(res.status).toBe(404);
  });

  test('過去への変更は400、存在しない予約は404', async () => {
    const created = await postSchedule({ content: 'あとで', scheduledAt: future() }, KEY1);
    const { data } = (await created.json()) as { data: { id: string } };
    const past = await patchScheduled(data.id, { scheduledAt: new Date(Date.now() - 60_000).toISOString() });
    expect(past.status).toBe(400);
    const missing = await patchScheduled('no-such', { content: 'x' });
    expect(missing.status).toBe(404);
  });
});
