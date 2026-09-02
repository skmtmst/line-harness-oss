import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getActiveOutgoingWebhooksByEvent,
  getOutgoingWebhookById,
  getOutgoingWebhooks,
} from '../src/webhooks.js';
import { asD1 } from './d1-test-helper.js';

describe('送信Webhookのアカウント・統括分離', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE line_accounts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT
      );
      CREATE TABLE outgoing_webhooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        event_types TEXT NOT NULL,
        secret TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        max_retries INTEGER NOT NULL DEFAULT 0,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_failed_at TEXT,
        line_account_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO line_accounts (id, tenant_id) VALUES
        ('account-a', 'tenant-a'),
        ('account-b', 'tenant-b');

      INSERT INTO outgoing_webhooks
        (id, name, url, event_types, line_account_id, created_at, updated_at)
      VALUES
        ('webhook-a', 'A', 'https://example.com/a', '["message_received"]', 'account-a', '2026-01-01', '2026-01-01'),
        ('webhook-b', 'B', 'https://example.com/b', '["message_received"]', 'account-b', '2026-01-01', '2026-01-01'),
        ('webhook-legacy', 'legacy', 'https://example.com/legacy', '["message_received"]', NULL, '2026-01-01', '2026-01-01'),
        ('webhook-star-b', 'star B', 'https://example.com/star-b', '["*"]', 'account-b', '2026-01-01', '2026-01-01');
    `);
    db = asD1(sqlite);
  });

  it('対象アカウントに明示所属するWebhookだけを返す', async () => {
    const rows = await getActiveOutgoingWebhooksByEvent(db, 'message_received', 'account-a');
    expect(rows.map((row) => row.id)).toEqual(['webhook-a']);
  });

  it('別統括では自アカウントのWebhookだけを返し、ワイルドカードにも分離を適用する', async () => {
    const rows = await getActiveOutgoingWebhooksByEvent(db, 'message_received', 'account-b');
    expect(rows.map((row) => row.id).sort()).toEqual(['webhook-b', 'webhook-star-b']);
  });

  it('アカウント不明のイベントは所属不明Webhookへ送らない', async () => {
    const rows = await getActiveOutgoingWebhooksByEvent(db, 'message_received');
    expect(rows).toEqual([]);
  });

  it('管理一覧は選択アカウントだけを返す', async () => {
    const rows = await getOutgoingWebhooks(db, 'account-a');
    expect(rows.map((row) => row.id)).toEqual(['webhook-a']);
  });

  it('別アカウントの管理一覧にも選択アカウントだけを返す', async () => {
    const rows = await getOutgoingWebhooks(db, 'account-b');
    expect(rows.map((row) => row.id).sort()).toEqual(['webhook-b', 'webhook-star-b']);
  });

  it('別アカウントのIDと存在しないIDは管理用の単一取得で見つからない', async () => {
    await expect(getOutgoingWebhookById(db, 'webhook-b', 'account-a')).resolves.toBeNull();
    await expect(getOutgoingWebhookById(db, 'missing', 'account-a')).resolves.toBeNull();
  });
});
