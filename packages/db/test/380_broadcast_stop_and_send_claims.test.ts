/*
 * #662 / N-059 — 一斉配信の停止と送達台帳。
 *
 * 見張っているのは4つ。
 *
 *   1. 停止は**版付きの条件付き更新**で1人だけが勝つ
 *   2. 停止した配信を、送信の拾い口が**二度と拾わない**
 *   3. 外へ出たかもしれない相手（送達不明）は**再送の対象に入らない**
 *   4. 決着の向き——送達不明は sent へ訂正できるが failed へは落とせない
 *
 * 4 が要点。送達不明を failed へ落とすと再送の対象に戻り、相手のトークに
 * 2通目が出る。この現場の既定（at-most-once）の逆になる。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asD1 } from './d1-test-helper.js';

import {
  getBlockedRecipientIds,
  getRetryableRecipientIds,
  countBroadcastLedger,
  markBroadcastRecipientsDispatched,
  settleBroadcastRecipients,
  closeClaimsForStop,
  reopenFailedClaims,
} from '../src/broadcast-send-claims.js';
import {
  requestBroadcastStop,
  resumeBroadcastSending,
  beginBroadcastRetryAttempt,
  isBroadcastStopped,
  getQueuedBroadcasts,
  recoverStalledBroadcasts,
} from '../src/broadcasts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

let bootstrapSql: string | null = null;

function setupDb(): Database.Database {
  bootstrapSql ??= readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8');
  const db = new Database(':memory:');
  db.exec(bootstrapSql);
  return db;
}

const SENDING_BROADCAST = `
  INSERT INTO broadcasts
    (id, title, message_type, message_content, target_type, status, batch_offset,
     segment_conditions, line_account_id, lock_version, created_at)
  VALUES
    ('b1', '案内', 'text', 'こんにちは', 'segment', 'sending', 0,
     '{"operator":"AND","rules":[]}', 'account-1', 3, '2026-09-11T10:00:00.000')`;

describe('380 一斉配信の停止と送達台帳', () => {
  let raw: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    raw = setupDb();
    raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1')`,
    ).run();
    raw.prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id)
       VALUES ('f1', 'U1', 'account-1'), ('f2', 'U2', 'account-1'),
              ('f3', 'U3', 'account-1'), ('f4', 'U4', 'account-1')`,
    ).run();
    raw.prepare(`INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '見込み', 'account-1')`).run();
    raw.prepare(SENDING_BROADCAST).run();
    db = asD1(raw);
  });

  afterEach(() => raw.close());

  describe('停止の受付', () => {
    it('版が一致した1回だけが勝つ', async () => {
      await expect(requestBroadcastStop(db, { id: 'b1', expectedVersion: 3 })).resolves.toBe(1);
      // 同じ版でもう一度押しても、もう止まっているので勝てない
      await expect(requestBroadcastStop(db, { id: 'b1', expectedVersion: 3 })).resolves.toBe(0);
      expect(await isBroadcastStopped(db, 'b1')).toBe(true);
      const row = raw.prepare(`SELECT lock_version, status FROM broadcasts WHERE id = 'b1'`).get() as {
        lock_version: number; status: string;
      };
      // 版は1つ進む。status は動かさない（送信中のままで「新しい送信権を
      // 取らない」だけが変わる）。
      expect(row).toEqual({ lock_version: 4, status: 'sending' });
    });

    it('版が食い違えば止まらない', async () => {
      await expect(requestBroadcastStop(db, { id: 'b1', expectedVersion: 2 })).resolves.toBe(0);
      expect(await isBroadcastStopped(db, 'b1')).toBe(false);
    });

    it('送信中でなければ止まらない', async () => {
      raw.prepare(`UPDATE broadcasts SET status = 'sent' WHERE id = 'b1'`).run();
      await expect(requestBroadcastStop(db, { id: 'b1', expectedVersion: 3 })).resolves.toBe(0);
    });
  });

  describe('停止した配信を拾わない', () => {
    it('キューの取得から外れる', async () => {
      expect((await getQueuedBroadcasts(db)).map((b) => b.id)).toEqual(['b1']);
      await requestBroadcastStop(db, { id: 'b1', expectedVersion: 3 });
      expect(await getQueuedBroadcasts(db)).toEqual([]);
    });

    it('停滞ロックの復旧から外れる（戻すと停止が黙って無効になる）', async () => {
      // ロックを持ったまま1時間止まっている状態を作る。
      raw.prepare(
        `UPDATE broadcasts SET batch_offset = -1,
            batch_lock_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours', '-60 minutes')
          WHERE id = 'b1'`,
      ).run();
      await requestBroadcastStop(db, { id: 'b1', expectedVersion: 3 });
      await recoverStalledBroadcasts(db);
      const row = raw.prepare(`SELECT batch_offset FROM broadcasts WHERE id = 'b1'`).get() as { batch_offset: number };
      expect(row.batch_offset).toBe(-1);

      // 止まっていなければ復旧する（この見張りが「常に -1 のまま」で緑に
      // ならないことを示す）。
      raw.prepare(`UPDATE broadcasts SET stopped_at = NULL WHERE id = 'b1'`).run();
      await recoverStalledBroadcasts(db);
      const recovered = raw.prepare(`SELECT batch_offset FROM broadcasts WHERE id = 'b1'`).get() as { batch_offset: number };
      expect(recovered.batch_offset).toBe(0);
    });
  });

  describe('送達台帳', () => {
    it('外へ出す前に押さえ、決着で閉じる', async () => {
      await markBroadcastRecipientsDispatched(db, {
        broadcastId: 'b1', attemptNo: 1, lineAccountId: 'account-1', friendIds: ['f1', 'f2'],
      });
      const claimed = raw.prepare(
        `SELECT friend_id, state, dispatched_at IS NOT NULL AS dispatched FROM broadcast_send_claims
          WHERE broadcast_id = 'b1' ORDER BY friend_id`,
      ).all() as Array<{ friend_id: string; state: string; dispatched: number }>;
      expect(claimed).toEqual([
        { friend_id: 'f1', state: 'claimed', dispatched: 1 },
        { friend_id: 'f2', state: 'claimed', dispatched: 1 },
      ]);

      await settleBroadcastRecipients(db, { broadcastId: 'b1', friendIds: ['f1'], state: 'sent' });
      await settleBroadcastRecipients(db, { broadcastId: 'b1', friendIds: ['f2'], state: 'failed', errorCode: 'line_http_400' });
      expect(await countBroadcastLedger(db, 'b1')).toEqual({ sent: 1, failed: 1, unknown: 0, claimed: 0 });
      expect([...await getBlockedRecipientIds(db, 'b1')]).toEqual(['f1']);
      expect(await getRetryableRecipientIds(db, 'b1')).toEqual(['f2']);
    });

    it('停止すると、外へ出した相手は送達不明・出す前の相手は失敗になる', async () => {
      // f1 は外へ出した（決着なし）。f2 は押さえただけ。
      await markBroadcastRecipientsDispatched(db, {
        broadcastId: 'b1', attemptNo: 1, lineAccountId: 'account-1', friendIds: ['f1'],
      });
      raw.prepare(
        `INSERT INTO broadcast_send_claims (broadcast_id, friend_id, attempt_no, state, created_at, updated_at)
         VALUES ('b1', 'f2', 1, 'claimed', '2026-09-11T10:00:00.000', '2026-09-11T10:00:00.000')`,
      ).run();

      await expect(closeClaimsForStop(db, 'b1')).resolves.toEqual({ unknown: 1, failed: 1 });
      expect(await countBroadcastLedger(db, 'b1')).toEqual({ sent: 0, failed: 1, unknown: 1, claimed: 0 });
      // 送達不明は再送の対象に入らない。
      expect(await getRetryableRecipientIds(db, 'b1')).toEqual(['f2']);
      expect([...await getBlockedRecipientIds(db, 'b1')]).toEqual(['f1']);
    });

    it('送達不明の相手は押さえ直せない（試行をまたいでも二重送信しない）', async () => {
      await markBroadcastRecipientsDispatched(db, {
        broadcastId: 'b1', attemptNo: 1, lineAccountId: 'account-1', friendIds: ['f1'],
      });
      await closeClaimsForStop(db, 'b1');
      await markBroadcastRecipientsDispatched(db, {
        broadcastId: 'b1', attemptNo: 2, lineAccountId: 'account-1', friendIds: ['f1'],
      });
      const row = raw.prepare(
        `SELECT state, attempt_no FROM broadcast_send_claims WHERE broadcast_id = 'b1' AND friend_id = 'f1'`,
      ).get() as { state: string; attempt_no: number };
      expect(row).toEqual({ state: 'unknown', attempt_no: 1 });
    });

    it('送達済みの相手も押さえ直せない', async () => {
      await markBroadcastRecipientsDispatched(db, {
        broadcastId: 'b1', attemptNo: 1, lineAccountId: 'account-1', friendIds: ['f1'],
      });
      await settleBroadcastRecipients(db, { broadcastId: 'b1', friendIds: ['f1'], state: 'sent' });
      await markBroadcastRecipientsDispatched(db, {
        broadcastId: 'b1', attemptNo: 2, lineAccountId: 'account-1', friendIds: ['f1'],
      });
      const row = raw.prepare(
        `SELECT state, attempt_no FROM broadcast_send_claims WHERE broadcast_id = 'b1' AND friend_id = 'f1'`,
      ).get() as { state: string; attempt_no: number };
      expect(row).toEqual({ state: 'sent', attempt_no: 1 });
    });

    it('送達不明は送達済みへ訂正できるが、失敗へは落とせない', async () => {
      // 停止の受付が先に走り、あとから「外の口は受け取っていた」と分かる形。
      await markBroadcastRecipientsDispatched(db, {
        broadcastId: 'b1', attemptNo: 1, lineAccountId: 'account-1', friendIds: ['f1', 'f2'],
      });
      await closeClaimsForStop(db, 'b1');
      await settleBroadcastRecipients(db, { broadcastId: 'b1', friendIds: ['f1'], state: 'sent' });
      // 失敗の決着は送達不明を動かさない。動かすと再送の対象へ戻り、
      // 相手のトークに2通目が出る。
      await settleBroadcastRecipients(db, { broadcastId: 'b1', friendIds: ['f2'], state: 'failed', errorCode: 'x' });
      expect(await countBroadcastLedger(db, 'b1')).toEqual({ sent: 1, failed: 0, unknown: 1, claimed: 0 });
      expect(await getRetryableRecipientIds(db, 'b1')).toEqual([]);
    });

    it('再送は失敗した相手だけ開け直す', async () => {
      await markBroadcastRecipientsDispatched(db, {
        broadcastId: 'b1', attemptNo: 1, lineAccountId: 'account-1', friendIds: ['f1', 'f2', 'f3'],
      });
      await settleBroadcastRecipients(db, { broadcastId: 'b1', friendIds: ['f1'], state: 'sent' });
      await settleBroadcastRecipients(db, { broadcastId: 'b1', friendIds: ['f2'], state: 'failed', errorCode: 'line_http_400' });
      await settleBroadcastRecipients(db, { broadcastId: 'b1', friendIds: ['f3'], state: 'unknown', errorCode: 'line_no_response' });

      await expect(reopenFailedClaims(db, 'b1', 2)).resolves.toBe(1);
      const rows = raw.prepare(
        `SELECT friend_id, state, attempt_no FROM broadcast_send_claims WHERE broadcast_id = 'b1' ORDER BY friend_id`,
      ).all();
      expect(rows).toEqual([
        { friend_id: 'f1', state: 'sent', attempt_no: 1 },
        { friend_id: 'f2', state: 'claimed', attempt_no: 2 },
        { friend_id: 'f3', state: 'unknown', attempt_no: 1 },
      ]);
    });
  });

  describe('再開と再送の版', () => {
    it('止まっているときだけ再開でき、版が一致した1回だけ勝つ', async () => {
      await expect(resumeBroadcastSending(db, { id: 'b1', expectedVersion: 3 })).resolves.toBe(0);
      await requestBroadcastStop(db, { id: 'b1', expectedVersion: 3 });
      raw.prepare(`UPDATE broadcasts SET batch_offset = -1 WHERE id = 'b1'`).run();
      await expect(resumeBroadcastSending(db, { id: 'b1', expectedVersion: 3 })).resolves.toBe(0);
      await expect(resumeBroadcastSending(db, { id: 'b1', expectedVersion: 4 })).resolves.toBe(1);
      const row = raw.prepare(
        `SELECT stopped_at, batch_offset, lock_version FROM broadcasts WHERE id = 'b1'`,
      ).get() as { stopped_at: string | null; batch_offset: number; lock_version: number };
      // ロックを持ったまま止まっていたので、先頭へ戻して歩き直す。台帳が
      // 送達済み・送達不明を覚えているので二重には送らない。
      expect(row).toEqual({ stopped_at: null, batch_offset: 0, lock_version: 5 });
    });

    it('送信済みからでも再送を始められ、試行番号が進む', async () => {
      raw.prepare(`UPDATE broadcasts SET status = 'sent', sent_at = '2026-09-11T11:00:00.000' WHERE id = 'b1'`).run();
      await expect(beginBroadcastRetryAttempt(db, { id: 'b1', expectedVersion: 9 }))
        .resolves.toEqual({ changes: 0, attemptNo: null });
      await expect(beginBroadcastRetryAttempt(db, { id: 'b1', expectedVersion: 3 }))
        .resolves.toEqual({ changes: 1, attemptNo: 2 });
      const row = raw.prepare(
        `SELECT status, sent_at, batch_offset, send_attempt_no, stopped_at FROM broadcasts WHERE id = 'b1'`,
      ).get();
      expect(row).toEqual({
        status: 'sending', sent_at: null, batch_offset: 0, send_attempt_no: 2, stopped_at: null,
      });
      // 再送はキューが拾える状態に戻る。
      expect((await getQueuedBroadcasts(db)).map((b) => b.id)).toEqual(['b1']);
    });

    it('下書き・予約中からは再送を始められない', async () => {
      raw.prepare(`UPDATE broadcasts SET status = 'draft' WHERE id = 'b1'`).run();
      await expect(beginBroadcastRetryAttempt(db, { id: 'b1', expectedVersion: 3 }))
        .resolves.toEqual({ changes: 0, attemptNo: null });
    });

    it('500人以下のタグ配信は、再送でキューの印を書いて拾えるようにする', async () => {
      raw.prepare(
        `UPDATE broadcasts SET status = 'sent', sent_at = '2026-09-11T11:00:00.000',
            target_type = 'tag', target_tag_id = 'tag-1', segment_conditions = NULL WHERE id = 'b1'`,
      ).run();
      expect(await getQueuedBroadcasts(db)).toEqual([]);
      await beginBroadcastRetryAttempt(db, {
        id: 'b1',
        expectedVersion: 3,
        segmentConditions: '{"operator":"AND","rules":[{"type":"tag_exists","value":"tag-1"}]}',
      });
      expect((await getQueuedBroadcasts(db)).map((b) => b.id)).toEqual(['b1']);
    });
  });
});
