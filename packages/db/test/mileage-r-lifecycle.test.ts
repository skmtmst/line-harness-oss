/**
 * R: 確定待ちの確定・取消と高額調整の二者承認、決めごとテストの直接試験。
 * bootstrap.sql(migrations適用済み)に対してSQLiteで動かす。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  approveMileageAdjustmentRequest,
  cancelMileageAdjustmentRequest,
  confirmPendingMileageEntry,
  createMileageAdjustmentApprovalRequest,
  getMileageSummaryForFriend,
  listMileageAdjustmentApprovalRequests,
  MileageV6Error,
  postMileageEntry,
  rejectMileageAdjustmentRequest,
  testMileageEarningRuleDraft,
  voidMileageLedgerEntry,
} from '../src/index.js';
import { asD1 } from './d1-test-helper.js';

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO users (id, display_name) VALUES ('user-1', '横断ユーザー');
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-1', 'channel-1', '公式A', 'token', 'secret'),
           ('account-2', 'channel-2', '公式B', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, user_id, line_account_id)
    VALUES ('friend-1', 'U1', 'ユーザーA', 'user-1', 'account-1');
    INSERT INTO mileage_programs (id, code, name, status, created_at, updated_at)
    VALUES ('default', 'default', '既定', 'active', '2026-01-01T00:00:00', '2026-01-01T00:00:00');
  `);
  db = asD1(sqlite);
});

afterEach(() => sqlite.close());

async function grantPending(amount = 50) {
  return postMileageEntry(db, {
    beneficiaryFriendId: 'friend-1',
    entryType: 'grant',
    status: 'pending',
    amount,
    reason: '予約完了',
    source: 'booking',
    idempotencyKey: `test:${crypto.randomUUID()}`,
  });
}

describe('R: 確定待ちの確定', () => {
  it('pending を確定すると available になり、残高へ乗る', async () => {
    const entry = await grantPending(80);
    const { entry: confirmed } = await confirmPendingMileageEntry(db, {
      entryId: entry.id, lineAccountId: 'account-1',
      staffId: 'staff-1', staffName: '担当A', reason: '来店確認できた',
    });
    expect(confirmed.status).toBe('available');
    const summary = await getMileageSummaryForFriend(db, 'friend-1');
    expect(summary.available).toBe(80);
    expect(summary.pending).toBe(0);
  });

  it('確定の再送は二重に動かない', async () => {
    const entry = await grantPending();
    await confirmPendingMileageEntry(db, {
      entryId: entry.id, lineAccountId: 'account-1',
      staffId: 'staff-1', staffName: '担当A', reason: '確認',
    });
    const again = await confirmPendingMileageEntry(db, {
      entryId: entry.id, lineAccountId: 'account-1',
      staffId: 'staff-1', staffName: '担当A', reason: '確認',
    });
    expect(again.alreadyConfirmed).toBe(true);
    const summary = await getMileageSummaryForFriend(db, 'friend-1');
    expect(summary.available).toBe(50);
  });

  it('理由なしの確定は400相当で止まる', async () => {
    const entry = await grantPending();
    await expect(confirmPendingMileageEntry(db, {
      entryId: entry.id, lineAccountId: 'account-1',
      staffId: 'staff-1', staffName: '担当A', reason: '  ',
    })).rejects.toMatchObject({ code: 'reason_required' });
  });
});

describe('R: 確定待ち・利用可能分の取消', () => {
  it('pending を取消すと void になり逆向きの記録が残る', async () => {
    const entry = await grantPending(30);
    const { reversalEntryId } = await voidMileageLedgerEntry(db, {
      entryId: entry.id, lineAccountId: 'account-1',
      staffId: 'staff-1', staffName: '担当A', reason: '注文キャンセル',
    });
    const rows = sqlite.prepare(
      `SELECT status, amount, entry_type, reverses_entry_id FROM mileage_ledger
        WHERE id = ? OR reverses_entry_id = ?`,
    ).all(entry.id, entry.id) as Array<{
      status: string; amount: number; entry_type: string; reverses_entry_id: string | null;
    }>;
    expect(rows.find((row) => row.entry_type === 'grant')?.status).toBe('void');
    const reversal = rows.find((row) => row.entry_type === 'reversal');
    expect(reversal?.amount).toBe(-30);
    expect(reversal?.status).toBe('void');
    expect(reversalEntryId).toBeTruthy();
  });

  it('取消の再送は逆向き行を増やさない', async () => {
    const entry = await grantPending(30);
    const first = await voidMileageLedgerEntry(db, {
      entryId: entry.id, lineAccountId: 'account-1',
      staffId: 'staff-1', staffName: '担当A', reason: '取り消し',
    });
    const second = await voidMileageLedgerEntry(db, {
      entryId: entry.id, lineAccountId: 'account-1',
      staffId: 'staff-1', staffName: '担当A', reason: '取り消し',
    });
    expect(second.replayed).toBe(true);
    expect(second.reversalEntryId).toBe(first.reversalEntryId);
    const count = sqlite.prepare(
      `SELECT COUNT(*) AS c FROM mileage_ledger WHERE reverses_entry_id = ?`,
    ).get(entry.id) as { c: number };
    expect(count.c).toBe(1);
  });

  it('利用可能分の取消は元の行を残して残高を減らす', async () => {
    const entry = await postMileageEntry(db, {
      beneficiaryFriendId: 'friend-1',
      entryType: 'grant', status: 'available', amount: 100,
      reason: '付与', source: 'test', idempotencyKey: `grant:${crypto.randomUUID()}`,
    });
    await voidMileageLedgerEntry(db, {
      entryId: entry.id, lineAccountId: 'account-1',
      staffId: 'staff-1', staffName: '担当A', reason: '誤付与',
    });
    const original = sqlite.prepare(
      `SELECT status FROM mileage_ledger WHERE id = ?`).get(entry.id) as { status: string };
    expect(original.status).toBe('available');
    const summary = await getMileageSummaryForFriend(db, 'friend-1');
    expect(summary.available).toBe(0);
  });

  it('残高を下回る取消は止まる', async () => {
    const entry = await postMileageEntry(db, {
      beneficiaryFriendId: 'friend-1',
      entryType: 'grant', status: 'available', amount: 100,
      reason: '付与', source: 'test', idempotencyKey: `grant:${crypto.randomUUID()}`,
    });
    await postMileageEntry(db, {
      beneficiaryFriendId: 'friend-1',
      entryType: 'spend', status: 'available', amount: -80,
      reason: '交換', source: 'test', idempotencyKey: `spend:${crypto.randomUUID()}`,
    });
    await expect(voidMileageLedgerEntry(db, {
      entryId: entry.id, lineAccountId: 'account-1',
      staffId: 'staff-1', staffName: '担当A', reason: '取消',
    })).rejects.toMatchObject({ code: 'insufficient_balance' });
  });

  it('理由なしの取消は止まる', async () => {
    const entry = await grantPending();
    await expect(voidMileageLedgerEntry(db, {
      entryId: entry.id, lineAccountId: 'account-1',
      staffId: 'staff-1', staffName: '担当A', reason: '',
    })).rejects.toMatchObject({ code: 'reason_required' });
  });
});

describe('R: 高額調整の二者承認', () => {
  const baseInput = {
    lineAccountId: 'account-1',
    friendId: 'friend-1',
    direction: 'increase' as const,
    amount: 5000,
    reasonCategory: 'correction',
    reason: 'キャンペーン補填',
    idempotencyKey: 'adj-req-1',
    staffId: 'staff-owner-1',
    staffName: 'オーナーA',
  };

  it('依頼→別人の承認→台帳へ記録される', async () => {
    const { request } = await createMileageAdjustmentApprovalRequest(db, baseInput);
    expect(request.status).toBe('pending');

    const { entry } = await approveMileageAdjustmentRequest(db, {
      requestId: request.id, lineAccountId: 'account-1',
      staffId: 'staff-owner-2', staffName: 'オーナーB',
    });
    expect(entry.amount).toBe(5000);
    const summary = await getMileageSummaryForFriend(db, 'friend-1');
    expect(summary.available).toBe(5000);

    const events = sqlite.prepare(
      `SELECT action FROM mileage_adjustment_approval_events WHERE request_id = ? ORDER BY created_at`,
    ).all(request.id) as Array<{ action: string }>;
    expect(events.map((row) => row.action).sort()).toEqual(['approved', 'requested']);
  });

  it('依頼した本人は承認できない', async () => {
    const { request } = await createMileageAdjustmentApprovalRequest(db, baseInput);
    await expect(approveMileageAdjustmentRequest(db, {
      requestId: request.id, lineAccountId: 'account-1',
      staffId: 'staff-owner-1', staffName: 'オーナーA',
    })).rejects.toMatchObject({ code: 'approval_self_not_allowed' });
  });

  it('同じキーの再送は依頼票を増やさない', async () => {
    const first = await createMileageAdjustmentApprovalRequest(db, baseInput);
    const second = await createMileageAdjustmentApprovalRequest(db, baseInput);
    expect(second.replayed).toBe(true);
    expect(second.request.id).toBe(first.request.id);
    const list = await listMileageAdjustmentApprovalRequests(db, { lineAccountId: 'account-1' });
    expect(list).toHaveLength(1);
  });

  it('差し戻しと取り下げができる', async () => {
    const { request } = await createMileageAdjustmentApprovalRequest(db, baseInput);
    const rejected = await rejectMileageAdjustmentRequest(db, {
      requestId: request.id, lineAccountId: 'account-1',
      staffId: 'staff-owner-2', staffName: 'オーナーB', decisionReason: '根拠が不明',
    });
    expect(rejected.status).toBe('rejected');

    const mine = await createMileageAdjustmentApprovalRequest(db, {
      ...baseInput, idempotencyKey: 'adj-req-2',
    });
    const cancelled = await cancelMileageAdjustmentRequest(db, {
      requestId: mine.request.id, lineAccountId: 'account-1', staffId: 'staff-owner-1',
    });
    expect(cancelled.status).toBe('cancelled');
    // 他人の依頼は取り下げられない
    const third = await createMileageAdjustmentApprovalRequest(db, {
      ...baseInput, idempotencyKey: 'adj-req-3',
    });
    await expect(cancelMileageAdjustmentRequest(db, {
      requestId: third.request.id, lineAccountId: 'account-1', staffId: 'staff-owner-2',
    })).rejects.toMatchObject({ code: 'approval_cancel_not_allowed' });
  });

  it('処理済みの依頼は二度決められない', async () => {
    const { request } = await createMileageAdjustmentApprovalRequest(db, baseInput);
    await approveMileageAdjustmentRequest(db, {
      requestId: request.id, lineAccountId: 'account-1',
      staffId: 'staff-owner-2', staffName: 'オーナーB',
    });
    await expect(rejectMileageAdjustmentRequest(db, {
      requestId: request.id, lineAccountId: 'account-1',
      staffId: 'staff-owner-3', staffName: 'オーナーC',
    })).rejects.toMatchObject({ code: 'approval_request_not_pending' });
  });
});

describe('R: 決めごとの事前テスト', () => {
  const draft = {
    name: 'テスト用', eventType: 'booking_completed', source: null,
    amount: 100, initialStatus: 'available' as const,
    validFrom: null, validUntil: null, expiresAfterDays: 30,
    cancellationEventTypes: [], targetConditions: null, sortOrder: 0,
    notification: { enabled: false, messageTemplate: '' },
  };

  it('直近30日のイベントから対象人数と付与見込みを返し、台帳には書かない', async () => {
    const now = new Date().toISOString();
    const recent = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    sqlite.prepare(
      `INSERT INTO engagement_events
         (id, program_id, idempotency_key, event_type, source, actor_friend_id, occurred_at, created_at)
       VALUES
         ('ev-1', 'default', 'k1', 'booking_completed', 'booking', 'friend-1', ?, ?),
         ('ev-2', 'default', 'k2', 'booking_completed', 'booking', 'friend-1', ?, ?),
         ('ev-3', 'default', 'k3', 'booking_completed', 'booking', 'friend-1', ?, ?)`,
    ).run(recent, now, recent, now, old, now);

    const result = await testMileageEarningRuleDraft(db, {
      lineAccountId: 'account-1', draft,
    });
    expect(result.matchedEvents).toBe(2);
    expect(result.matchedFriends).toBe(1);
    expect(result.estimatedTotalMiles).toBe(200);
    expect(result.maxPerFriend).toBe(200);
    expect(result.expirationExampleAt).not.toBeNull();

    const ledgerCount = sqlite.prepare(`SELECT COUNT(*) AS c FROM mileage_ledger`).get() as { c: number };
    const queueCount = sqlite.prepare(`SELECT COUNT(*) AS c FROM mileage_event_queue`).get() as { c: number };
    expect(ledgerCount.c).toBe(0);
    expect(queueCount.c).toBe(0);
  });

  it('同じきっかけで動く既存ルールを重複として返す', async () => {
    sqlite.prepare(
      `INSERT INTO mileage_rules (id, program_id, name, event_type, amount, initial_status, line_account_id, is_active, created_at, updated_at)
       VALUES ('rule-1', 'default', '予約でたまる', 'booking_completed', 100, 'available', 'account-1', 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00')`,
    ).run();
    const result = await testMileageEarningRuleDraft(db, {
      lineAccountId: 'account-1', draft,
    });
    expect(result.overlappingRuleNames).toEqual(['予約でたまる']);
  });
});
