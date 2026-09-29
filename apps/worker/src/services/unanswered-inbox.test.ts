import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeUnansweredInbox, countUnanswered } from './unanswered-inbox.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const BOOTSTRAP = join(ROOT, 'packages/db/bootstrap.sql');

interface ObservedQuery {
  sql: string;
  params: unknown[];
  returnedRows: number;
}

function asObservedD1(sqlite: Database.Database, observed: ObservedQuery[]): D1Database {
  function prepare(sql: string): D1PreparedStatement {
    const statement = sqlite.prepare(sql);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        const results = statement.all(...params) as T[];
        observed.push({ sql, params, returnedRows: results.length });
        return { results, success: true, meta: {} };
      },
      async first<T>() {
        const row = (statement.get(...params) as T | undefined) ?? null;
        observed.push({ sql, params, returnedRows: row === null ? 0 : 1 });
        return row;
      },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return { prepare } as unknown as D1Database;
}

describe('未対応一覧のDBページング', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  let observed: ObservedQuery[];

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(BOOTSTRAP, 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('a1', 'channel-1', '本店', 'token', 'secret'),
             ('a2', 'channel-2', '支店', 'token', 'secret');
    `);
    observed = [];
    db = asObservedD1(sqlite, observed);
  });

  afterEach(() => sqlite.close());

  function addConversation(input: {
    id: string;
    accountId?: string | null;
    displayName?: string;
    actionableAt: string;
    content: string;
    status?: string;
    manualAt?: string | null;
    pictureUrl?: string | null;
  }): void {
    sqlite.prepare(
      `INSERT INTO friends
         (id, line_user_id, display_name, picture_url, line_account_id, is_following)
       VALUES (?, ?, ?, ?, ?, 1)`,
    ).run(
      input.id,
      `U-${input.id}`,
      input.displayName ?? input.id,
      input.pictureUrl ?? null,
      input.accountId === undefined ? 'a1' : input.accountId,
    );
    sqlite.prepare(
      `INSERT INTO chats
         (id, friend_id, status, last_message_at, last_customer_message_at,
          last_operator_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `chat-${input.id}`,
      input.id,
      input.status ?? 'unread',
      input.manualAt ?? input.actionableAt,
      input.actionableAt,
      input.manualAt ?? null,
      input.actionableAt,
      input.actionableAt,
    );
    sqlite.prepare(
      `INSERT INTO messages_log
         (id, friend_id, direction, message_type, content, source, created_at)
       VALUES (?, ?, 'incoming', 'text', ?, 'user', ?)`,
    ).run(`message-${input.id}`, input.id, input.content, input.actionableAt);
  }

  it('自動応答済みの後続メッセージではなく、投影済みの要対応受信を返す', async () => {
    addConversation({
      id: 'friend-a',
      displayName: '山田',
      actionableAt: '2026-09-01T10:00:00+09:00',
      content: '100%確認したいです',
    });
    // この後続受信は自動応答済みなので、Webhookは chat.last_customer_message_at を更新しない。
    sqlite.prepare(
      `INSERT INTO messages_log
         (id, friend_id, direction, message_type, content, source, created_at)
       VALUES ('matched-later', 'friend-a', 'incoming', 'text', '導入相談', 'user',
               '2026-09-01T11:00:00+09:00'),
              ('machine', 'friend-a', 'outgoing', 'text', '自動返信', 'auto_reply',
               '2026-09-01T11:00:01+09:00')`,
    ).run();
    addConversation({
      id: 'friend-replied',
      actionableAt: '2026-09-01T09:00:00+09:00',
      manualAt: '2026-09-01T09:05:00+09:00',
      content: '返信済み',
    });
    addConversation({
      id: 'friend-resolved',
      actionableAt: '2026-09-01T08:00:00+09:00',
      content: '解決済み',
      status: 'resolved',
    });

    const result = await computeUnansweredInbox(db, {
      q: '100%',
      allowedAccountIds: ['a1'],
      canSeeUnassigned: false,
    });

    expect(result.total).toBe(1);
    expect(result.rows).toEqual([
      expect.objectContaining({
        friendId: 'friend-a',
        lastIncomingAt: '2026-09-01T10:00:00+09:00',
        lastIncomingContent: '100%確認したいです',
        lastMachineAt: '2026-09-01T11:00:01+09:00',
      }),
    ]);
  });

  it('アカウント範囲・ページ・最大200件をDB側で適用する', async () => {
    for (let i = 1; i <= 205; i++) {
      addConversation({
        id: `friend-${String(i).padStart(3, '0')}`,
        actionableAt: `2026-09-${String(1 + Math.floor((i - 1) / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00+09:00`,
        content: `質問 ${i}`,
      });
    }
    addConversation({
      id: 'friend-other-account',
      accountId: 'a2',
      actionableAt: '2026-09-20T10:00:00+09:00',
      content: '別店舗',
    });
    addConversation({
      id: 'friend-unassigned',
      accountId: null,
      actionableAt: '2026-09-20T11:00:00+09:00',
      content: '未割当',
    });

    const first = await computeUnansweredInbox(db, {
      page: 1,
      pageSize: 2_000,
      allowedAccountIds: ['a1'],
      canSeeUnassigned: false,
    });
    const second = await computeUnansweredInbox(db, {
      page: 2,
      pageSize: 2_000,
      allowedAccountIds: ['a1'],
      canSeeUnassigned: false,
    });

    expect(first).toMatchObject({ total: 205, page: 1, pageSize: 200 });
    expect(first.rows).toHaveLength(200);
    expect(second.rows).toHaveLength(5);
    expect(first.rows.some((row) => row.accountId !== 'a1')).toBe(false);
  });

  it('1万件超の履歴でもWorkerへ返す行数はページサイズとCOUNT結果だけに抑える', async () => {
    const insertMessage = sqlite.prepare(
      `INSERT INTO messages_log
         (id, friend_id, direction, message_type, content, source, created_at)
       VALUES (?, ?, 'incoming', 'text', ?, 'user', ?)`,
    );
    const transaction = sqlite.transaction(() => {
      for (let friendNo = 1; friendNo <= 250; friendNo++) {
        const friendId = `load-${String(friendNo).padStart(3, '0')}`;
        const finalAt = `2026-08-31T${String(friendNo % 24).padStart(2, '0')}:59:00+09:00`;
        addConversation({ id: friendId, actionableAt: finalAt, content: '最後の質問' });
        for (let messageNo = 0; messageNo < 40; messageNo++) {
          insertMessage.run(
            `history-${friendNo}-${messageNo}`,
            friendId,
            `過去 ${messageNo}`,
            `2026-08-${String(1 + (messageNo % 28)).padStart(2, '0')}T00:${String(messageNo).padStart(2, '0')}:00+09:00`,
          );
        }
      }
    });
    transaction();
    observed = [];
    db = asObservedD1(sqlite, observed);

    const result = await computeUnansweredInbox(db, {
      pageSize: 25,
      allowedAccountIds: ['a1'],
      canSeeUnassigned: false,
    });

    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM messages_log`).get()).toEqual({ count: 10_250 });
    expect(result).toMatchObject({ total: 250, pageSize: 25 });
    expect(result.rows).toHaveLength(25);
    expect(observed.map((query) => query.returnedRows).sort((a, b) => a - b)).toEqual([1, 25]);
    expect(observed.every((query) => !query.sql.includes('SELECT ml.friend_id, ml.message_type'))).toBe(true);
    const pageQuery = observed.find((query) => query.sql.includes('LIMIT ? OFFSET ?'))!;
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${pageQuery.sql}`).all(...pageQuery.params) as Array<{
      detail: string;
    }>;
    expect(
      plan.some((row) => row.detail.includes('idx_chats_unanswered_page')),
      JSON.stringify(plan),
    ).toBe(true);
    expect(
      plan.some((row) => row.detail.includes('idx_messages_log_friend_direction_created')),
      JSON.stringify(plan),
    ).toBe(true);
    expect(
      plan.some((row) => row.detail.includes('idx_messages_log_friend_direction_source_created')),
      JSON.stringify(plan),
    ).toBe(true);
  });

  it('件数は一覧本文を取得せず、アカウント別件数と最古待ち時間を集約する', async () => {
    addConversation({
      id: 'friend-a1', accountId: 'a1', actionableAt: '2026-08-01T10:00:00+09:00', content: 'A',
    });
    addConversation({
      id: 'friend-a2', accountId: 'a2', actionableAt: '2026-08-02T10:00:00+09:00', content: 'B',
    });
    addConversation({
      id: 'friend-none', accountId: null, actionableAt: '2026-08-03T10:00:00+09:00', content: 'C',
    });

    const result = await countUnanswered(db, {
      allowedAccountIds: ['a1', 'a2'],
      canSeeUnassigned: true,
    });

    expect(result.total).toBe(3);
    expect(result.byAccount).toEqual(expect.arrayContaining([
      { accountId: '__unassigned__', accountName: '(未分類)', count: 1 },
      { accountId: 'a1', accountName: '本店', count: 1 },
      { accountId: 'a2', accountName: '支店', count: 1 },
    ]));
    expect(result.oldestWaitMinutes).toBeGreaterThan(0);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.sql).not.toContain('messages_log');
  });
});
