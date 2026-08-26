import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = readFileSync(join(ROOT, 'migrations', '192_inbox_v6_foundation.sql'), 'utf8');

function legacyDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE friends (id TEXT PRIMARY KEY);
    CREATE TABLE operators (id TEXT PRIMARY KEY);
    INSERT INTO friends VALUES ('friend-1');
    INSERT INTO operators VALUES ('operator-1');
    CREATE TABLE chats (
      id TEXT PRIMARY KEY,
      friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
      operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('unread','in_progress','resolved')),
      notes TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      line_account_id TEXT,
      first_replied_at TEXT,
      last_incoming_at TEXT
    );
    INSERT INTO chats VALUES (
      'chat-1','friend-1','operator-1','in_progress','引き継ぎメモ',
      '2026-08-26T10:00:00Z','2026-08-26T09:00:00Z','2026-08-26T10:00:00Z',
      'account-1',NULL,'2026-08-26T09:55:00Z'
    );
    CREATE UNIQUE INDEX idx_chats_friend_unique ON chats(friend_id);

    CREATE TABLE support_email_threads (
      id TEXT PRIMARY KEY,
      customer_email TEXT NOT NULL,
      customer_name TEXT,
      subject TEXT NOT NULL,
      normalized_subject TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('unread','in_progress','resolved')),
      assigned_staff_id TEXT,
      last_message_at TEXT NOT NULL,
      last_incoming_at TEXT NOT NULL,
      last_outgoing_at TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      notes TEXT
    );
    CREATE TABLE support_email_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES support_email_threads(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
      sender_email TEXT NOT NULL,
      sender_name TEXT,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      message_id TEXT UNIQUE,
      in_reply_to TEXT,
      references_header TEXT,
      sent_by_staff_id TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO support_email_threads VALUES (
      'thread-1','customer@example.com','顧客','質問','質問','resolved',NULL,
      '2026-08-26T10:00:00Z','2026-08-26T09:00:00Z','2026-08-26T10:00:00Z',
      '2026-08-26T10:00:00Z','2026-08-26T09:00:00Z','2026-08-26T10:00:00Z','メールメモ'
    );
    INSERT INTO support_email_messages VALUES (
      'mail-1','thread-1','incoming','customer@example.com',NULL,'support@example.com',
      '質問','本文','message-1',NULL,NULL,NULL,'2026-08-26T09:00:00Z'
    );
  `);
  return db;
}

describe('migration 192: V6受信箱の基盤', () => {
  it('既存のLINE・メール・メモを失わず4状態とrevisionを追加する', () => {
    const db = legacyDatabase();
    db.exec(MIGRATION);

    expect(db.prepare(`SELECT status, notes, revision, last_customer_message_at FROM chats`).get())
      .toEqual({
        status: 'in_progress',
        notes: '引き継ぎメモ',
        revision: 0,
        last_customer_message_at: '2026-08-26T09:55:00Z',
      });
    expect(db.prepare(`SELECT id, body_text FROM support_email_messages`).get())
      .toEqual({ id: 'mail-1', body_text: '本文' });
    expect(db.prepare(`SELECT channel, body FROM inbox_notes ORDER BY channel`).all())
      .toEqual([
        { channel: 'email', body: 'メールメモ' },
        { channel: 'line', body: '引き継ぎメモ' },
      ]);

    expect(() => db.prepare(`UPDATE chats SET status = 'on_hold' WHERE id = 'chat-1'`).run())
      .not.toThrow();
    expect(() => db.prepare(`UPDATE support_email_threads SET status = 'on_hold' WHERE id = 'thread-1'`).run())
      .not.toThrow();
    expect(() => db.prepare(`UPDATE chats SET status = 'waiting' WHERE id = 'chat-1'`).run())
      .toThrow(/CHECK constraint failed/);
    db.close();
  });

  it('担当・状態・メモの履歴を会話ごとに追記できる', () => {
    const db = legacyDatabase();
    db.exec(MIGRATION);
    db.prepare(`
      INSERT INTO inbox_conversation_events
        (id, channel, conversation_id, event_type, before_json, after_json,
         actor_staff_id, correlation_id, created_at)
      VALUES ('event-1','line','friend-1','status','{"status":"unread"}',
              '{"status":"on_hold"}','staff-1','correlation-1','2026-08-26T11:00:00Z')
    `).run();
    expect(db.prepare(`SELECT event_type, json_extract(after_json, '$.status') AS status FROM inbox_conversation_events`).get())
      .toEqual({ event_type: 'status', status: 'on_hold' });
    db.close();
  });

  it('有効な返信リースを別担当者が上書きできず、期限後だけ引き継げる', () => {
    const db = legacyDatabase();
    db.exec(MIGRATION);
    const acquire = db.prepare(`
      INSERT INTO inbox_reply_leases
        (channel, conversation_id, staff_id, acquired_at, expires_at, conversation_revision)
      VALUES ('line', 'friend-1', ?, ?, ?, 0)
      ON CONFLICT(channel, conversation_id) DO UPDATE SET
        staff_id = excluded.staff_id,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at,
        conversation_revision = excluded.conversation_revision
      WHERE inbox_reply_leases.expires_at <= excluded.acquired_at
         OR inbox_reply_leases.staff_id = excluded.staff_id
    `);
    expect(acquire.run('staff-a', '2026-08-26T10:00:00Z', '2026-08-26T10:01:00Z').changes).toBe(1);
    expect(acquire.run('staff-b', '2026-08-26T10:00:30Z', '2026-08-26T10:01:30Z').changes).toBe(0);
    expect(db.prepare(`SELECT staff_id FROM inbox_reply_leases`).get()).toEqual({ staff_id: 'staff-a' });
    expect(acquire.run('staff-b', '2026-08-26T10:01:01Z', '2026-08-26T10:02:01Z').changes).toBe(1);
    expect(db.prepare(`SELECT staff_id FROM inbox_reply_leases`).get()).toEqual({ staff_id: 'staff-b' });
    db.close();
  });
});
