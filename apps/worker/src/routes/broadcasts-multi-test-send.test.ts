import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';

const line = vi.hoisted(() => ({ pushMessage: vi.fn() }));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class {
    pushMessage = line.pushMessage;
  },
}));

const { broadcasts } = await import('./broadcasts.js');

describe('複数吹き出しのテスト送信', () => {
  beforeEach(() => line.pushMessage.mockReset().mockResolvedValue({}));

  it('本番と同じ2通をまとめて送り、2通ぶんを記録する', async () => {
    const { db, raw } = createTestD1();
    raw.prepare(
      `INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret, is_active)
       VALUES ('account-1', 'channel-1', '本店', 'token', 'secret', 1)`,
    ).run();
    insertFriend(raw, 'friend-1', { line_account_id: 'account-1', display_name: '田中' });
    raw.prepare(
      `INSERT INTO account_settings (id, line_account_id, key, value)
       VALUES ('setting-1', 'account-1', 'test_recipients', '["friend-1"]')`,
    ).run();
    raw.prepare(
      `INSERT INTO broadcasts
        (id, title, message_type, message_content, message_bubbles_json, target_type,
         status, line_account_id, track_links, created_at)
       VALUES ('broadcast-1', '試験', 'text', 'legacy', ?, 'all', 'draft', 'account-1', 0,
         '2026-01-01T00:00:00.000')`,
    ).run(JSON.stringify([
      { id: '1', type: 'text', content: { text: '{{name}}さんへ' } },
      { id: '2', type: 'text', content: { text: '二通目です' } },
    ]));

    const app = new Hono<{ Bindings: { DB: D1Database; WORKER_URL: string } }>();
    app.use('*', async (c, next) => {
      c.env = { DB: db, WORKER_URL: 'https://worker.test' };
      c.set('staff' as never, { id: 'owner', name: 'Owner', role: 'owner', readOnly: false } as never);
      await next();
    });
    app.route('/', broadcasts);
    const response = await app.request('/api/broadcasts/broadcast-1/test-send', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(line.pushMessage).toHaveBeenCalledTimes(1);
    expect(line.pushMessage.mock.calls[0][1]).toEqual([
      { type: 'text', text: '【テスト配信】\n田中さんへ' },
      { type: 'text', text: '二通目です' },
    ]);
    const logs = raw.prepare(
      `SELECT message_type, content FROM messages_log WHERE delivery_type = 'test' ORDER BY rowid`,
    ).all() as Array<{ message_type: string; content: string }>;
    expect(logs).toHaveLength(2);
  });
});
