/*
 * 画像と本文の結合送信(N-022)。
 *
 * 実DB（better-sqlite3 + bootstrap.sql）に実物の chats ルートを当て、
 * LINE clientだけを止める。単体送信口2回呼びの部分送信を直す。
 *   - 片方の検証失敗時はLINE呼び出し0回・保存0件
 *   - LINEへは1回のpush要求のメッセージ配列として送る
 *   - 同じkey＋同じ内容の再送は同じ結果でLINE再送なし、違う内容は409
 *   - 別accountは404。既存の本文だけ・画像だけ送信は変えない
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';

const pushMessage = vi.fn().mockResolvedValue({ sentMessages: [{}, {}] });
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({ pushMessage })),
}));

const { chats } = await import('./chats.js');

let sqlite: SqliteD1;

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};
const scopedAdmin: AuthenticatedStaff = {
  id: 'admin-scoped', name: '店1だけ', role: 'admin', readOnly: false, tenantId: 'tenant-1',
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

function postCombined(body: unknown, key: string, staff: AuthenticatedStaff = owner, chatId = 'fr-1') {
  return app(staff).request(`/api/chats/${chatId}/send-combined`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
}

const IMAGE = { originalContentUrl: 'https://x/o.jpg', previewImageUrl: 'https://x/p.jpg' };
const KEY1 = '11111111-2222-4333-8444-555555555555';
const KEY2 = '22222222-2222-4333-8444-555555555555';
const KEY3 = '33333333-2222-4333-8444-555555555555';
const KEY4 = '44444444-2222-4333-8444-555555555555';
const KEY5 = '55555555-2222-4333-8444-555555555555';

function rows(): Array<{ id: string; message_type: string }> {
  return sqlite.raw.prepare(
    `SELECT id, message_type FROM messages_log WHERE friend_id = 'fr-1' ORDER BY id`,
  ).all() as Array<{ id: string; message_type: string }>;
}

function seed(): void {
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
    `INSERT INTO staff_members (id, name, role, api_key, tenant_id, account_scope, permission_keys)
     VALUES ('admin-scoped', '店1だけ', 'admin', 'key-scoped', 'tenant-1', 'accounts', '[]')`,
  ).run();
  raw.prepare(
    `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
     VALUES ('admin-scoped', 'acc-1', '2026-09-01T00:00:00.000Z')`,
  ).run();
  raw.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES ('fr-1', 'U-1', '利用者1', 'acc-1')`,
  ).run();
}

beforeEach(() => {
  vi.clearAllMocks();
  pushMessage.mockResolvedValue({ sentMessages: [{}, {}] });
  sqlite = createTestD1();
  seed();
});

describe('結合送信(N-022)', () => {
  test('画像も本文も1回のpushで送り、履歴が2件残る', async () => {
    const res = await postCombined({ image: IMAGE, text: 'こんにちは', revision: 0 }, KEY1);
    expect(res.status).toBe(200);
    expect(pushMessage).toHaveBeenCalledTimes(1);
    const [, messages] = pushMessage.mock.calls[0] as [string, Array<{ type: string }>, string];
    expect(messages.map((m) => m.type)).toEqual(['image', 'text']);
    expect(rows().map((r) => r.message_type)).toEqual(['image', 'text']);
  });

  test('長文混じりは400で、LINE呼び出し0回・保存0件', async () => {
    const res = await postCombined({ image: IMAGE, text: 'x'.repeat(5001), revision: 0 }, KEY2);
    expect(res.status).toBe(400);
    expect(pushMessage).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });

  test('壊れた画像は400で、LINE呼び出し0回・保存0件', async () => {
    const res = await postCombined(
      { image: { originalContentUrl: '', previewImageUrl: '' }, text: 'こんにちは', revision: 0 }, KEY3);
    expect(res.status).toBe(400);
    expect(pushMessage).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });

  test('同じkey＋同じ内容の再送は同じ結果でLINE再送なし', async () => {
    const first = await postCombined({ image: IMAGE, text: 'こんにちは', revision: 0 }, KEY1);
    expect(first.status).toBe(200);
    const second = await postCombined({ image: IMAGE, text: 'こんにちは' }, KEY1);
    expect(second.status).toBe(200);
    const body = (await second.json()) as { data: { replayed: boolean } };
    expect(body.data.replayed).toBe(true);
    expect(pushMessage).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(2);
  });

  test('同じkey＋違う内容は409', async () => {
    const first = await postCombined({ image: IMAGE, text: 'こんにちは', revision: 0 }, KEY1);
    expect(first.status).toBe(200);
    const second = await postCombined({ image: IMAGE, text: 'さようなら' }, KEY1);
    expect(second.status).toBe(409);
    expect(pushMessage).toHaveBeenCalledTimes(1);
  });

  test('担当外accountは404で、LINE呼び出し0回・保存0件', async () => {
    sqlite.raw.prepare(
      `INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES ('fr-2', 'U-2', '利用者2', 'acc-2')`,
    ).run();
    const hidden = await postCombined({ image: IMAGE, text: 'こんにちは' }, KEY4, scopedAdmin, 'fr-2');
    expect(hidden.status).toBe(404);
    expect(pushMessage).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });

  test('画像だけ・本文だけも結合口で送れる', async () => {
    const imgOnly = await postCombined({ image: IMAGE, revision: 0 }, KEY2);
    expect(imgOnly.status).toBe(200);
    const [, messages] = pushMessage.mock.calls[0] as [string, Array<{ type: string }>, string];
    expect(messages.map((m) => m.type)).toEqual(['image']);
  });

  /*
   * G-4: テンプレートのパック送信。texts は選んだ順のまま1回のpushに
   * まとまり、履歴も1通ごとに残る。6通以上はLINEのpush上限を超える
   * のでLINE呼び出し0回で止める。
   */
  test('texts を選んだ順に1回のpushで送り、履歴が1通ごとに残る', async () => {
    const res = await postCombined(
      { texts: ['あいさつ', '案内', '締め'], revision: 0 }, KEY5);
    expect(res.status).toBe(200);
    expect(pushMessage).toHaveBeenCalledTimes(1);
    const [, messages] = pushMessage.mock.calls[0] as [string, Array<{ type: string; text?: string }>, string];
    expect(messages.map((m) => m.text)).toEqual(['あいさつ', '案内', '締め']);
    expect(rows()).toHaveLength(3);
    const body = (await res.json()) as { data: { messageIds: string[] } };
    expect(body.data.messageIds).toHaveLength(3);
  });

  test('texts と画像を合わせても1回のpushで、画像が先頭に来る', async () => {
    const res = await postCombined(
      { image: IMAGE, texts: ['1通目', '2通目'], revision: 0 }, KEY5);
    expect(res.status).toBe(200);
    const [, messages] = pushMessage.mock.calls[0] as [string, Array<{ type: string }>, string];
    expect(messages.map((m) => m.type)).toEqual(['image', 'text', 'text']);
    expect(rows().map((r) => r.message_type)).toEqual(['image', 'text', 'text']);
  });

  test('合計6通以上は400で、LINE呼び出し0回・保存0件', async () => {
    const res = await postCombined(
      { texts: ['1', '2', '3', '4', '5', '6'], revision: 0 }, KEY5);
    expect(res.status).toBe(400);
    expect(pushMessage).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });
});
