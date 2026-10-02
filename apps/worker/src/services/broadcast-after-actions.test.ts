import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { createAutomationActionExecutors } from './automation-action-executors.js';
import { processBroadcastAfterActions } from './broadcast-after-actions.js';

/*
 * 一斉配信の送信後動作は、LINEが受け付けた宛先にだけ実行する。
 *
 * 送信前に動かすと届かなかった人にもタグが付く。失敗した宛先に動かすと
 * 「届いた人」の印が嘘になる。受理（send_claims = sent）を確認してから
 * 固定した公開版を実行し、失敗・送達不明の宛先には触れない。
 */
let db: SqliteD1;

const TAG_CONFIG = JSON.stringify([
  { id: 'a1', type: 'add_tag', params: { tagId: 'tag-done' }, onFailure: 'continue' },
]);

beforeEach(() => {
  db = createTestD1();
  db.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '本店', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
    VALUES ('friend-ok', 'U-ok', '届いた人', 'account-a', 1),
           ('friend-ng', 'U-ng', '届かなかった人', 'account-a', 1),
           ('friend-unknown', 'U-unknown', '分からない人', 'account-a', 1);
    INSERT INTO tags (id, line_account_id, name) VALUES ('tag-done', 'account-a', '配信済み');
    INSERT INTO common_actions (id, line_account_id, name, status)
    VALUES ('ca-1', 'account-a', '配信済みタグ', 'published');
    INSERT INTO common_action_versions (id, common_action_id, version_number, status, action_config)
    VALUES ('cav-1', 'ca-1', 1, 'published', '${TAG_CONFIG.replace(/'/g, "''")}');
    INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id, after_action_version_id)
    VALUES ('bc-1', '案内', 'text', '本文', 'tag', 'sending', 'account-a', 'cav-1');
    INSERT INTO broadcast_send_claims (broadcast_id, friend_id, line_account_id, attempt_no, state)
    VALUES ('bc-1', 'friend-ok', 'account-a', 1, 'sent'),
           ('bc-1', 'friend-ng', 'account-a', 1, 'failed'),
           ('bc-1', 'friend-unknown', 'account-a', 1, 'unknown');
  `);
});
afterEach(() => { db.raw.close(); });

function hasTag(friendId: string): boolean {
  const row = db.raw.prepare(
    `SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = 'tag-done'`,
  ).get(friendId);
  return row !== undefined;
}

describe('送信後動作は受理後に実行し失敗宛先に触れない (P1-06)', () => {
  it('受理した宛先にだけ固定版を実行する', async () => {
    const result = await processBroadcastAfterActions(db.db, {
      broadcastId: 'bc-1',
      executors: createAutomationActionExecutors(),
    });
    expect(result.done).toBe(1);
    expect(hasTag('friend-ok')).toBe(true);
    expect(hasTag('friend-ng')).toBe(false);
    expect(hasTag('friend-unknown')).toBe(false);
    const runs = db.raw.prepare(
      `SELECT friend_id, status FROM broadcast_after_action_runs WHERE broadcast_id = 'bc-1'`,
    ).all() as Array<{ friend_id: string; status: string }>;
    // 失敗・送達不明の宛先には台帳の行すら作らない。
    expect(runs).toEqual([{ friend_id: 'friend-ok', status: 'done' }]);
  });

  it('二度走っても二重に実行しない', async () => {
    const executors = createAutomationActionExecutors();
    await processBroadcastAfterActions(db.db, { broadcastId: 'bc-1', executors });
    const second = await processBroadcastAfterActions(db.db, { broadcastId: 'bc-1', executors });
    expect(second.done).toBe(0);
    expect(second.failed).toBe(0);
    // 実行済みの宛先は拾い直さない（タグ付けは1回きり）。
    expect(hasTag('friend-ok')).toBe(true);
    const tagCount = db.raw.prepare(
      `SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id = 'friend-ok' AND tag_id = 'tag-done'`,
    ).get() as { n: number };
    expect(tagCount.n).toBe(1);
  });

  it('止める指定の失敗で後続を止め、無指定は続ける', async () => {
    // 公開版は不変なので、別アクションの別版を用意する。
    const stopConfig = JSON.stringify([
      { id: 'a1', type: 'add_tag', params: { tagId: 'tag-missing' }, onFailure: 'stop' },
      { id: 'a2', type: 'add_tag', params: { tagId: 'tag-done' }, onFailure: 'continue' },
    ]).replace(/'/g, "''");
    db.raw.exec(`
      INSERT INTO common_actions (id, line_account_id, name, status)
      VALUES ('ca-2', 'account-a', '止める試し', 'published');
      INSERT INTO common_action_versions (id, common_action_id, version_number, status, action_config)
      VALUES ('cav-2', 'ca-2', 1, 'published', '${stopConfig}');
      INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id, after_action_version_id)
      VALUES ('bc-2', '案内2', 'text', '本文', 'tag', 'sending', 'account-a', 'cav-2');
      INSERT INTO broadcast_send_claims (broadcast_id, friend_id, line_account_id, attempt_no, state)
      VALUES ('bc-2', 'friend-ok', 'account-a', 1, 'sent');
    `);
    const result = await processBroadcastAfterActions(db.db, {
      broadcastId: 'bc-2',
      executors: createAutomationActionExecutors(),
    });
    expect(result.failed).toBe(1);
    // 止める指定で落ちたので2つ目は実行しない。
    expect(hasTag('friend-ok')).toBe(false);
    const runs = db.raw.prepare(
      `SELECT action_id, status FROM broadcast_after_action_runs WHERE broadcast_id = 'bc-2' AND friend_id = 'friend-ok' ORDER BY action_id`,
    ).all() as Array<{ action_id: string; status: string }>;
    expect(runs).toEqual([
      { action_id: 'a1', status: 'failed' },
    ]);
  });
});
