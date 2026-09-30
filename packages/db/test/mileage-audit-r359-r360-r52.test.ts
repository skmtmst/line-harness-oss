/**
 * 監査 R359・R360・R52追加の再現試験（m22u 追加分）。
 *
 * - R359: 成果のマイルを取り消しても、交換用の付与内訳に使用可能なまま残る
 * - R360: 期限切れマイルが利用可能残高に含まれ、交換すると内訳エラーになる
 * - R52追加: 1日で失効の設定が付与処理に届かない
 *
 * すべて「直す前は落ち・直した後は通る」ことを意図した恒久試験。
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { decideConversionApproval } from '../src/affiliate-offers.js';
import {
  applyMileageRulesForEvent,
  createMileageRule,
  getMileageSummaryForFriend,
  postMileageEntry,
  processPendingMileageEvents,
  syncAffiliateConversionMileage,
} from '../src/mileage.js';
import {
  publishMileageEarningRule,
  saveMileageEarningRuleDraft,
} from '../src/mileage-admin-v6.js';
import {
  MileageRewardError,
  createMileageRewardDraft,
  importMileageRewardCodes,
  publishMileageReward,
  refundMileageRewardRedemption,
  reserveMileageRewardRedemption,
} from '../src/mileage-rewards.js';
import { asD1 } from './d1-test-helper.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
let sqlite: Database.Database;
let db: D1Database;

function seed() {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO users (id, display_name) VALUES ('user-1', '利用者');
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('account-1', 'channel-1', '本店', 'token', 'secret', '${TENANT_ID}');
    INSERT INTO friends (id, line_user_id, display_name, user_id, line_account_id)
    VALUES ('friend-1', 'U1', '田中', 'user-1', 'account-1'),
           ('friend-2', 'U2', '佐藤', 'user-1', 'account-1');
    INSERT INTO affiliates
      (id, name, code, commission_rate, friend_id, tenant_id, line_account_id, hold_days)
    VALUES ('affiliate-fixed', '定額さん', 'fixed-code', 0, 'friend-2', '${TENANT_ID}', 'account-1', 0);
    INSERT INTO conversion_points (id, name, event_type, value, line_account_id)
    VALUES ('point-1', '購入', 'purchase', 10000, 'account-1');
    INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
    VALUES ('default', 'default', 'Harnessマイル', '2026-08-01', '2026-08-01');
    INSERT INTO affiliate_offers (id, name, reward_amount, reward_miles, line_account_id, created_at)
    VALUES ('offer-1', '定期便', 1000, 100, 'account-1', '2026-08-01');
    INSERT INTO affiliate_links (id, affiliate_id, ref_code, line_account_id, offer_id, created_at)
    VALUES ('link-1', 'affiliate-fixed', 'ref-1', 'account-1', 'offer-1', '2026-08-01');
    INSERT INTO conversion_events
      (id, conversion_point_id, friend_id, affiliate_id, attributed_ref_code, approval_status)
    VALUES ('ce-1', 'point-1', 'friend-1', 'affiliate-fixed', 'ref-1', NULL);
  `);
  db = asD1(sqlite);
}

function lotOf(ledgerId: string) {
  return sqlite.prepare(
    `SELECT ledger_entry_id, remaining_amount, status, expires_at
       FROM mileage_grant_lots WHERE ledger_entry_id = ?`,
  ).get(ledgerId) as
    | { ledger_entry_id: string; remaining_amount: number; status: string; expires_at: string | null }
    | undefined;
}

function grantLedgerIds(): string[] {
  // 同一ミリ秒の作成で created_at が並ぶと id（乱数）の順で裏返るため、
  // 投入順そのものの rowid で割る（付与の生成順＝この試験の前提）。
  return (sqlite.prepare(
    `SELECT id FROM mileage_ledger WHERE entry_type = 'grant' AND status = 'available' ORDER BY created_at, rowid`,
  ).all() as Array<{ id: string }>).map((row) => row.id);
}

async function approveAndGrant(eventId = 'ce-1') {
  await decideConversionApproval(db, eventId, 'approved', 'pending');
  await syncAffiliateConversionMileage(db, eventId, 'approved');
}

let rewardSeq = 0;
async function makePublishedRewardId(requiredMiles: number): Promise<string> {
  rewardSeq += 1;
  const draft = await createMileageRewardDraft(db, {
    lineAccountId: 'account-1',
    draft: { name: `特典${rewardSeq}`, rewardKind: 'coupon', requiredMiles, customerMessage: 'どうぞ' },
  });
  await importMileageRewardCodes(db, {
    rewardId: draft.id,
    lineAccountId: 'account-1',
    codes: [{ ciphertext: `encrypted-${rewardSeq}`, fingerprint: `fp-${rewardSeq}` }],
  });
  await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
  return draft.id;
}

beforeEach(() => {
  seed();
});

describe('R359 取消済み付与の交換内訳除外', () => {
  it('却下で未使用ロットが使用不可になり別付与だけが選ばれる', async () => {
    await approveAndGrant('ce-1');
    const [grantA] = grantLedgerIds();
    expect(lotOf(grantA!)).toMatchObject({ remaining_amount: 100, status: 'available' });

    // 別の正常な付与100を追加してからCE1を却下。
    await postMileageEntry(db, {
      beneficiaryUserId: 'user-1', beneficiaryFriendId: 'friend-2',
      entryType: 'grant', status: 'available', amount: 100,
      reason: '別付与', source: 'test', sourceEventId: 'other-1',
      idempotencyKey: 'test:other-1', occurredAt: '2026-09-01T00:00:00.000+09:00',
    });
    const [, grantB] = grantLedgerIds();
    await decideConversionApproval(db, 'ce-1', 'rejected', 'approved');
    await syncAffiliateConversionMileage(db, 'ce-1', 'rejected');

    // 取消済みロットは使用元に選ばれない。
    expect(lotOf(grantA!)?.status).not.toBe('available');
    expect(lotOf(grantA!)?.remaining_amount).toBe(0);

    const rewardId = await makePublishedRewardId(60);
    const { redemption } = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-2', rewardId,
      idempotencyKey: 'redeem-1', requestFingerprint: 'fp-1',
    });
    expect(redemption.status).toBe('reserved');
    const allocations = sqlite.prepare(
      `SELECT grant_lot_id FROM mileage_spend_allocations WHERE redemption_id = ?`,
    ).all(redemption.id) as Array<{ grant_lot_id: string }>;
    expect(allocations.map((item) => item.grant_lot_id)).toEqual([grantB]);
  });

  it('返却しても取消済みロットは使用可能に戻らない', async () => {
    await approveAndGrant('ce-1');
    const [grantA] = grantLedgerIds();
    const rewardId = await makePublishedRewardId(60);
    const first = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-2', rewardId,
      idempotencyKey: 'redeem-2', requestFingerprint: 'fp-2',
    });
    // 予約後に成果を却下し、その後交換を返却する。
    await decideConversionApproval(db, 'ce-1', 'rejected', 'approved');
    await syncAffiliateConversionMileage(db, 'ce-1', 'rejected');
    await refundMileageRewardRedemption(db, { redemptionId: first.redemption.id, reason: '検証' });

    expect(lotOf(grantA!)?.status).not.toBe('available');
  });
});

describe('R360 期限切れ残高の一致', () => {
  it('期限切れは残高に数えず交換は不足として案内する', async () => {
    await postMileageEntry(db, {
      beneficiaryUserId: 'user-1', beneficiaryFriendId: 'friend-2',
      entryType: 'grant', status: 'available', amount: 100,
      reason: '期限付き', source: 'test', sourceEventId: 'expiry-1',
      idempotencyKey: 'test:expiry-1', occurredAt: '2026-09-01T00:00:00.000+09:00',
      metadata: { expiresAt: '2026-09-02T00:00:00.000+09:00' },
    });
    const summary = await getMileageSummaryForFriend(db, 'friend-2');
    expect(summary.available).toBe(0);

    const rewardId = await makePublishedRewardId(60);
    try {
      await reserveMileageRewardRedemption(db, {
        lineAccountId: 'account-1', friendId: 'friend-2', rewardId,
        idempotencyKey: 'redeem-3', requestFingerprint: 'fp-3',
      });
      throw new Error('reserve should have failed');
    } catch (error) {
      expect(error).toBeInstanceOf(MileageRewardError);
      expect((error as MileageRewardError).code).toBe('insufficient_miles');
    }
  });
});

describe('R52追加 失効日数の付与への反映', () => {
  it('紹介成果のきっかけでも1日で失効の設定が付与ロットの期限になる', async () => {
    const rule = await createMileageRule(db, {
      name: '紹介でたまる', eventType: 'affiliate_conversion_approved', source: 'affiliate_conversion',
      amount: 100, initialStatus: 'available', lineAccountId: 'account-1',
    });
    const saved = await saveMileageEarningRuleDraft(db, {
      ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: null,
      draft: {
        name: '紹介でたまる', eventType: 'affiliate_conversion_approved', source: 'affiliate_conversion',
        amount: 100, initialStatus: 'available', validFrom: null, validUntil: null,
        expiresAfterDays: 1, cancellationEventTypes: [], targetConditions: null,
        sortOrder: 0, notification: { enabled: false, messageTemplate: '' },
      },
      updatedByStaffId: 'staff-1',
    });
    await publishMileageEarningRule(db, {
      ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: saved.version,
      staffId: 'staff-1', idempotencyKey: 'pub-aff-1',
    });
    // 成果承認がキューへ載せたきっかけを処理し、ルール付与に期限が載る。
    await approveAndGrant('ce-1');
    await processPendingMileageEvents(db, {});

    const grants = sqlite.prepare(
      `SELECT l.id, g.expires_at AS lot_expires
         FROM mileage_ledger l LEFT JOIN mileage_grant_lots g ON g.ledger_entry_id = l.id
        WHERE l.mileage_rule_id = ?`,
    ).all(rule.id) as Array<{ id: string; lot_expires: string | null }>;
    expect(grants.length).toBe(1);
    expect(grants[0]!.lot_expires).not.toBeNull();
  });

  it('1日で失効の設定が付与ロットの期限になる', async () => {
    const rule = await createMileageRule(db, {
      name: '失効付き', eventType: 'message_received', source: 'line',
      amount: 300, initialStatus: 'available', lineAccountId: 'account-1',
    });
    const saved = await saveMileageEarningRuleDraft(db, {
      ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: null,
      draft: {
        name: '失効付き', eventType: 'message_received', source: 'line', amount: 300,
        initialStatus: 'available', validFrom: null, validUntil: null,
        expiresAfterDays: 1, cancellationEventTypes: [], targetConditions: null,
        sortOrder: 0, notification: { enabled: false, messageTemplate: '' },
      },
      updatedByStaffId: 'staff-1',
    });
    await publishMileageEarningRule(db, {
      ruleId: rule.id, lineAccountId: 'account-1', expectedVersion: saved.version,
      staffId: 'staff-1', idempotencyKey: 'pub-1',
    });
    const occurredAt = new Date(Date.now() - 3600_000).toISOString();
    const expectedExpiry = new Date(Date.parse(occurredAt) + 86400_000).toISOString();
    await applyMileageRulesForEvent(db, {
      eventType: 'message_received', source: 'line', sourceEventId: 'expiry-rule-1',
      friendId: 'friend-1', occurredAt,
    });
    await processPendingMileageEvents(db, {});

    const grants = sqlite.prepare(
      `SELECT l.id, l.metadata, g.expires_at AS lot_expires
         FROM mileage_ledger l LEFT JOIN mileage_grant_lots g ON g.ledger_entry_id = l.id
        WHERE l.mileage_rule_id = ?`,
    ).all(rule.id) as Array<{ id: string; metadata: string | null; lot_expires: string | null }>;
    expect(grants.length).toBe(1);
    expect(grants[0]!.lot_expires).toBe(expectedExpiry);
  });
});
