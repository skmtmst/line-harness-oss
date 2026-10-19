import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { markInboxConversationRead } from '../src/inbox-reads.js';

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const result = sqlite.prepare(query).run(...params);
              return { results: [], success: true, meta: { changes: result.changes } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('担当者別の受信箱既読', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE inbox_staff_reads (
        staff_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        last_read_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (staff_id, channel, conversation_id)
      )
    `);
    db = asD1(sqlite);
  });

  it('Aさんが読んでもBさんの読み取り位置は変えない', async () => {
    await markInboxConversationRead(db, {
      staffId: 'staff-a', channel: 'line', conversationId: 'friend-1',
      lastReadAt: '2026-08-20T10:00:00.000Z',
    });
    await markInboxConversationRead(db, {
      staffId: 'staff-b', channel: 'line', conversationId: 'friend-1',
      lastReadAt: '2026-08-20T09:00:00.000Z',
    });

    const rows = sqlite.prepare(
      `SELECT staff_id, last_read_at FROM inbox_staff_reads ORDER BY staff_id`,
    ).all() as Array<{ staff_id: string; last_read_at: string }>;
    expect(rows).toEqual([
      { staff_id: 'staff-a', last_read_at: '2026-08-20T10:00:00.000Z' },
      { staff_id: 'staff-b', last_read_at: '2026-08-20T09:00:00.000Z' },
    ]);
  });

  it('古い画面の遅い応答で既読位置を巻き戻さない', async () => {
    await markInboxConversationRead(db, {
      staffId: 'staff-a', channel: 'email', conversationId: 'thread-1',
      lastReadAt: '2026-08-20T10:00:00.000Z',
    });
    await markInboxConversationRead(db, {
      staffId: 'staff-a', channel: 'email', conversationId: 'thread-1',
      lastReadAt: '2026-08-20T09:00:00.000Z',
    });

    const row = sqlite.prepare(
      `SELECT last_read_at FROM inbox_staff_reads WHERE staff_id = 'staff-a'`,
    ).get() as { last_read_at: string };
    expect(row.last_read_at).toBe('2026-08-20T10:00:00.000Z');
  });
});
