import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getActionScoreBandOverview,
  getMileageEarningRulesV6,
  getMileageFriendsV6,
  getMileageHistoryPeriodSummary,
  getMileageRewardReachMetrics,
  markMileageAdjustmentNotification,
  MileageV6Error,
  reserveMileageAdjustmentNotification,
  saveMileageEarningRuleDraft,
} from '../src/mileage-admin-v6.js';
import { getMileageAdminHistory, postMileageAdjustment } from '../src/mileage.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(import.meta.dirname, '..');

describe('V6 mileage admin read models', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO mileage_programs (id, code, name, status, created_at, updated_at)
      VALUES ('default', 'default', 'Harnessマイル', 'active', datetime('now'), datetime('now'));
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('account-1', 'channel-1', '公式A', 'token-a', 'secret-a'),
             ('account-2', 'channel-2', '公式B', 'token-b', 'secret-b');
      INSERT INTO friends (id, line_user_id, display_name, line_account_id, score)
      VALUES ('friend-1', 'U11111111111111111111111111111111', '利用者A', 'account-1', 80),
             ('friend-2', 'U22222222222222222222222222222222', '利用者B', 'account-2', 20);
      INSERT INTO mileage_rules
        (id, program_id, name, event_type, source, amount, initial_status, is_active, created_at, updated_at)
      VALUES ('builtin-message-received', 'default', 'メッセージ送信', 'message_received', 'line', 1,
              'available', 1, datetime('now'), datetime('now')),
             ('builtin-link-clicked', 'default', 'リンククリック', 'link_clicked', 'tracked_link', 2,
              'available', 1, datetime('now'), datetime('now'));
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('keeps earning-rule drafts account-scoped and rejects stale versions and overlong conditions', async () => {
    const draft = {
      name: 'メッセージ特典', eventType: 'message_received', source: 'line', amount: 5,
      initialStatus: 'available', validFrom: null, validUntil: null, expiresAfterDays: 90,
      cancellationEventTypes: ['message_deleted'],
      targetConditions: { operator: 'AND', rules: [{ type: 'tag_exists', value: '会員' }] },
      sortOrder: 2,
      notification: {
        enabled: true,
        messageTemplate: '{awardedMiles}マイル付きました。残高は{balance}マイルです。',
      },
    } as const;
    const first = await saveMileageEarningRuleDraft(db, {
      ruleId: 'builtin-message-received', lineAccountId: 'account-1', expectedVersion: 0,
      draft, updatedByStaffId: 'staff-1',
    });
    expect(first).toMatchObject({ lineAccountId: 'account-1', version: 1, draft });

    const listed = await getMileageEarningRulesV6(db, { lineAccountId: 'account-1', limit: 20, offset: 0 });
    expect(listed.items[0]).toMatchObject({
      id: 'builtin-message-received', draftVersion: 1,
      metrics30d: { eligible: 0, granted: 0, excluded: 0 },
    });
    expect((await getMileageEarningRulesV6(db, {
      lineAccountId: 'account-2', limit: 20, offset: 0,
    })).items).toEqual([]);

    await expect(saveMileageEarningRuleDraft(db, {
      ruleId: 'builtin-message-received', lineAccountId: 'account-1', expectedVersion: 0,
      draft, updatedByStaffId: 'staff-2',
    })).rejects.toMatchObject<MileageV6Error>({ code: 'version_conflict', status: 409 });

    const tooMany = Array.from({ length: 16 }, (_, index) => ({ type: 'tag_exists', value: `tag-${index}` }));
    await expect(saveMileageEarningRuleDraft(db, {
      ruleId: 'builtin-link-clicked', lineAccountId: 'account-1', expectedVersion: 0,
      draft: { ...draft, targetConditions: { operator: 'OR', rules: tooMany } },
    })).rejects.toMatchObject<MileageV6Error>({ code: 'target_conditions_too_many' });

    await expect(saveMileageEarningRuleDraft(db, {
      ruleId: 'builtin-link-clicked', lineAccountId: 'account-1', expectedVersion: 0,
      draft: { ...draft, notification: { enabled: true, messageTemplate: '' } },
    })).rejects.toMatchObject<MileageV6Error>({ code: 'notification_message_required' });
  });

  it('returns real balances, expiration, period totals, score reasons, and reward reach', async () => {
    const expiresAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const adjustment = await postMileageAdjustment(db, {
      friendId: 'friend-1', lineAccountId: 'account-1', amount: 400,
      reason: 'キャンペーン', reasonCategory: 'campaign', idempotencyKey: 'adjustment-v6-1',
      executedByStaffId: 'staff-1', executedByStaffName: '担当者',
      expiresAt,
    });
    sqlite.exec(`
      INSERT INTO friend_scores (id, friend_id, score_change, reason, created_at)
      VALUES ('score-1', 'friend-1', 10, 'メッセージ返信', datetime('now'));
      INSERT INTO mileage_rewards
        (id, line_account_id, name, reward_kind, status, sort_order)
      VALUES ('reward-1', 'account-1', 'ゴールド', 'rank', 'published', 1);
      INSERT INTO mileage_reward_versions (id, reward_id, version_number, required_miles, status)
      VALUES ('reward-version-1', 'reward-1', 1, 300, 'published');
      UPDATE mileage_rewards SET current_published_version_id = 'reward-version-1' WHERE id = 'reward-1';
    `);

    const friends = await getMileageFriendsV6(db, {
      lineAccountId: 'account-1', visibleAccountIds: ['account-1'], search: '', limit: 20, offset: 0,
    });
    expect(friends.summary).toMatchObject({
      totalMembers: 1, available: 400, monthChange: 400,
      rankCounts: [{ rewardId: 'reward-1', rankName: 'ゴールド', requiredMiles: 300, friendCount: 1 }],
    });
    expect(friends.items[0]).toMatchObject({
      friendId: 'friend-1', available: 400, monthChange: 400, rank: 'ゴールド',
      rankThreshold: 300, nextRank: null, milesToNextRank: null,
    });
    expect(friends.items[0].expiringMiles30d).toBe(400);

    const history = await getMileageHistoryPeriodSummary(db, { lineAccountId: 'account-1' });
    expect(history).toMatchObject({ totalAmount: 400, manualCount: 1, pendingCount: 0 });
    expect(history.byType).toContainEqual({ entryType: 'adjustment', count: 1, amount: 400 });
    const adminHistory = await getMileageAdminHistory(db, { accountId: 'account-1' });
    expect(adminHistory.items[0]).toMatchObject({ lineAccountName: '公式A', balanceAfter: 400 });

    const bands = await getActionScoreBandOverview(db, 'account-1');
    expect(bands.bandSummaries).toContainEqual({
      band: 'high', friendCount: 1, change30d: 10,
      topReasons: [{ reason: 'メッセージ返信', count: 1 }],
    });

    const reach = await getMileageRewardReachMetrics(db, 'account-1');
    expect(reach[0]).toMatchObject({
      rewardName: 'ゴールド', rewardKind: 'rank', requiredMiles: 300,
      reachableFriendCount: 1, redeemedFriendCount: 0, exchangeRate: 0,
    });
    expect(adjustment.entry.id).toBeTruthy();
  });

  it('records one adjustment notification and preserves its delivery status', async () => {
    const adjustment = await postMileageAdjustment(db, {
      friendId: 'friend-1', lineAccountId: 'account-1', amount: 10,
      reason: '個別調整', reasonCategory: 'other', idempotencyKey: 'adjustment-v6-notify',
      executedByStaffId: 'staff-1', executedByStaffName: '担当者',
    });
    const input = {
      lineAccountId: 'account-1', friendId: 'friend-1', ledgerEntryId: adjustment.entry.id,
      idempotencyKey: '11111111-2222-4333-8444-555555555555', message: 'マイルが増えました',
    };
    const reserved = await reserveMileageAdjustmentNotification(db, input);
    expect(reserved).toMatchObject({ status: 'pending', attemptCount: 0 });
    const sent = await markMileageAdjustmentNotification(db, {
      id: reserved.id, status: 'sent', lineRequestId: 'line-request-1',
    });
    expect(sent).toMatchObject({ status: 'sent', attemptCount: 1, lineRequestId: 'line-request-1' });
    expect(await reserveMileageAdjustmentNotification(db, input)).toMatchObject({
      id: reserved.id, status: 'sent', attemptCount: 1,
    });
    await expect(postMileageAdjustment(db, {
      friendId: 'friend-1', lineAccountId: 'account-1', amount: 10,
      reason: '個別調整', reasonCategory: 'other', idempotencyKey: 'adjustment-v6-notify',
      executedByStaffId: 'staff-1', executedByStaffName: '担当者', notifyFriend: true,
    })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
});
