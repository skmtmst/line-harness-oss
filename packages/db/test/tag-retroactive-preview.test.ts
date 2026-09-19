import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getTagRetroactiveMileagePreview } from '../src/tags.js';
import { asD1 } from './d1-test-helper.js';

/*
 * N-047: 遡及マイル実行の前にサーバー側で数える事前計算。
 * 実行側(mileage.ts)と同じ条件で数えることを、実SQLで確かめる。
 */
let sqlite: Database.Database;
let db: D1Database;

function grantSelf(friendId: string, userId: string | null) {
  const identity = userId ? `user:${userId}` : `friend:${friendId}`;
  sqlite.prepare(
    `INSERT INTO mileage_ledger
       (id, program_id, beneficiary_user_id, beneficiary_friend_id,
        entry_type, status, amount, reason, source, idempotency_key,
        occurred_at, created_at)
     VALUES (?, 'default', ?, ?, 'grant', 'available', 100, 'test', 'tag', ?,
             '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run(`ledger-${friendId}`, userId, friendId, `tag-reward:identity:${identity}:tag:tag-1`);
}

function grantReferral(referrerUserId: string | null, referrerFriendId: string, referredUserId: string | null, referredFriendId: string) {
  const referrerKey = referrerUserId ? `user:${referrerUserId}` : `friend:${referrerFriendId}`;
  const referredKey = referredUserId ? `user:${referredUserId}` : `friend:${referredFriendId}`;
  sqlite.prepare(
    `INSERT INTO mileage_ledger
       (id, program_id, beneficiary_user_id, beneficiary_friend_id,
        entry_type, status, amount, reason, source, idempotency_key,
        occurred_at, created_at)
     VALUES (?, 'default', ?, ?, 'grant', 'available', 20, 'test', 'tag_referral', ?,
             '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
  ).run(
    `ledger-ref-${referredFriendId}`,
    referrerUserId,
    referrerFriendId,
    `tag-referral:referrer:${referrerKey}:referred:${referredKey}:tag:tag-1`,
  );
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(
    `INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
     VALUES ('default', 'default', '既定', '2026-01-01', '2026-01-01')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', '店舗1', 'token', 'secret')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO users (id, display_name)
     VALUES ('user-1', '一郎'), ('user-2', '二郎'), ('user-3', '三郎'), ('user-ref', '紹介者')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, display_name, user_id, line_account_id)
     VALUES ('friend-1', 'lu-1', '一郎', 'user-1', 'account-1'),
            ('friend-2', 'lu-2', '二郎', 'user-2', 'account-1'),
            ('friend-3', 'lu-3', '三郎', 'user-3', 'account-1'),
            ('referrer-1', 'lu-ref', '紹介者', 'user-ref', 'account-1')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO tags (id, name, line_account_id) VALUES ('tag-1', '対象', 'account-1')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO friend_tags (friend_id, tag_id)
     VALUES ('friend-1', 'tag-1'), ('friend-2', 'tag-1'), ('friend-3', 'tag-1')`,
  ).run();
  // friend-1 は紹介者経由。追跡は友だち登録の±1日以内に限る。
  sqlite.prepare(
    `INSERT INTO affiliates (id, name, code, commission_rate, friend_id)
     VALUES ('aff-1', '紹介者', 'AFFREF', 0, 'referrer-1')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO affiliate_links (id, affiliate_id, ref_code, created_at)
     VALUES ('al-1', 'aff-1', 'ref-code-1', '2026-09-01T00:00:00.000Z')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO ref_tracking (id, ref_code, friend_id)
     VALUES ('rt-1', 'ref-code-1', 'friend-1')`,
  ).run();
  db = asD1(sqlite);
});

describe('getTagRetroactiveMileagePreview（N-047 事前計算）', () => {
  it('タグの友だち・本人対象・紹介者対象を実行側と同じ条件で数える', async () => {
    const preview = await getTagRetroactiveMileagePreview(db, 'tag-1');
    expect(preview).not.toBeNull();
    expect(preview!.lineAccountId).toBe('account-1');
    expect(preview!.friendIds.sort()).toEqual(['friend-1', 'friend-2', 'friend-3']);
    // 未付与なら全員が本人対象
    expect(preview!.selfTargetIds.sort()).toEqual(['friend-1', 'friend-2', 'friend-3']);
    expect(preview!.selfExcludedIds).toEqual([]);
    // 紹介経由があるのは friend-1 だけ
    expect(preview!.referralTargetIds).toEqual(['friend-1']);
    expect(preview!.referralExcludedIds).toEqual([]);
  });

  it('本人マイルをすでに受け取っている友だちは対象から外す', async () => {
    grantSelf('friend-3', 'user-3');
    const preview = await getTagRetroactiveMileagePreview(db, 'tag-1');
    expect(preview!.selfTargetIds.sort()).toEqual(['friend-1', 'friend-2']);
    expect(preview!.selfExcludedIds).toEqual(['friend-3']);
  });

  it('取り消し済み(void)の付与は除外対象にしない', async () => {
    grantSelf('friend-3', 'user-3');
    sqlite.prepare(`UPDATE mileage_ledger SET status = 'void'`).run();
    const preview = await getTagRetroactiveMileagePreview(db, 'tag-1');
    expect(preview!.selfExcludedIds).toEqual([]);
    expect(preview!.selfTargetIds).toContain('friend-3');
  });

  it('紹介者側へすでに付与済みなら紹介者対象から外す', async () => {
    grantReferral('user-ref', 'referrer-1', 'user-1', 'friend-1');
    const preview = await getTagRetroactiveMileagePreview(db, 'tag-1');
    expect(preview!.referralTargetIds).toEqual([]);
    expect(preview!.referralExcludedIds).toEqual(['friend-1']);
    // 本人対象の計算は紹介者側の付与に影響されない
    expect(preview!.selfTargetIds).toContain('friend-1');
  });

  it('同一人物(user_id)を持つ別行の紹介追跡も拾う', async () => {
    // friend-1 自身の追跡を消し、同一 user_id の別アカウント行が持つ形にする
    sqlite.prepare(`DELETE FROM ref_tracking`).run();
    sqlite.prepare(
      `INSERT INTO friends (id, line_user_id, display_name, user_id, line_account_id)
       VALUES ('friend-1b', 'lu-1b', '一郎(別アカウント)', 'user-1', 'account-1')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO ref_tracking (id, ref_code, friend_id)
       VALUES ('rt-1b', 'ref-code-1', 'friend-1b')`,
    ).run();
    const preview = await getTagRetroactiveMileagePreview(db, 'tag-1');
    expect(preview!.referralTargetIds).toEqual(['friend-1']);
  });

  it('本人への紹介（同一人物）は紹介者対象にしない', async () => {
    // 紹介者を friend-1 と同じ user に差し替える
    sqlite.prepare(`UPDATE affiliates SET friend_id = 'friend-1' WHERE id = 'aff-1'`).run();
    const preview = await getTagRetroactiveMileagePreview(db, 'tag-1');
    expect(preview!.referralTargetIds).toEqual([]);
  });

  it('登録から1日以上離れた紹介追跡は拾わない', async () => {
    sqlite.prepare(
      `UPDATE ref_tracking SET created_at = '2020-01-01T00:00:00.000Z'`,
    ).run();
    const preview = await getTagRetroactiveMileagePreview(db, 'tag-1');
    expect(preview!.referralTargetIds).toEqual([]);
  });

  it('存在しないタグは null を返す', async () => {
    await expect(getTagRetroactiveMileagePreview(db, 'tag-nope')).resolves.toBeNull();
  });
});
