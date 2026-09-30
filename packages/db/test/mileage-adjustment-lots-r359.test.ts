/**
 * R359: 手動減算と付与内訳の一致（m25d）。
 *
 * 手動減算（postMileageAdjustment の decrease）は台帳だけを動かし、
 * 交換用の付与内訳（mileage_grant_lots）を更新しないため、
 * 「残高100・使用可能ロット200」の不整合になった。
 * 減算・取消・再試行・同時操作・境界値を隔離試験で守る恒久試験。
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getMileageSummaryForFriend,
  postMileageAdjustment,
  postMileageEntry,
} from '../src/mileage.js';
import { voidMileageLedgerEntry } from '../src/mileage-approvals.js';
import {
  MileageRewardError,
  createMileageRewardDraft,
  importMileageRewardCodes,
  publishMileageReward,
  reserveMileageRewardRedemption,
} from '../src/mileage-rewards.js';
import { asD1 } from './d1-test-helper.js';

let sqlite: Database.Database;
let db: D1Database;

function seed() {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO users (id, display_name) VALUES ('user-1', '本人');
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('acc-a', 'ch-a', 'アカウントA', 'token-a', 'secret-a');
    INSERT INTO friends (id, line_user_id, display_name, user_id, line_account_id)
    VALUES ('fa-1', 'UA1', 'Aのプロフィール', 'user-1', 'acc-a');
    INSERT INTO mileage_programs (id, code, name, status, created_at, updated_at)
    VALUES ('default', 'default', 'Harnessマイル', 'active', '2026-01-01', '2026-01-01');
  `);
  db = asD1(sqlite);
}

beforeEach(seed);
afterEach(() => sqlite.close());

let seq = 0;
function nextKey(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

async function grant(amount: number, overrides: { key?: string; expiresAt?: string | null } = {}) {
  return postMileageEntry(db, {
    beneficiaryUserId: 'user-1',
    beneficiaryFriendId: 'fa-1',
    entryType: 'grant',
    status: 'available',
    amount,
    reason: '付与',
    source: 'test',
    sourceEventId: overrides.key ?? nextKey('grant'),
    idempotencyKey: `test:${overrides.key ?? nextKey('grant-key')}`,
    occurredAt: '2026-09-01T00:00:00.000+09:00',
    ...(overrides.expiresAt ? { metadata: { expiresAt: overrides.expiresAt } } : {}),
  });
}

function adjust(
  amount: number,
  overrides: Partial<Parameters<typeof postMileageAdjustment>[1]> = {},
) {
  return postMileageAdjustment(db, {
    friendId: 'fa-1',
    amount,
    reason: '手動調整',
    reasonCategory: 'grant_correction',
    idempotencyKey: nextKey('adj'),
    executedByStaffId: 'staff-1',
    executedByStaffName: '担当者',
    lineAccountId: 'acc-a',
    ...overrides,
  });
}

/** 交換で使えるロットの残数の合計。期限切れ・使用不可は含めない。 */
function usableLotsTotal(now = new Date().toISOString()): number {
  const row = sqlite.prepare(
    `SELECT COALESCE(SUM(remaining_amount), 0) AS total FROM mileage_grant_lots
      WHERE status = 'available' AND remaining_amount > 0
        AND (expires_at IS NULL OR expires_at > ?)`,
  ).get(now) as { total: number };
  return Number(row.total);
}

function lotOf(ledgerId: string) {
  return sqlite.prepare(
    `SELECT ledger_entry_id, remaining_amount, status FROM mileage_grant_lots
      WHERE ledger_entry_id = ?`,
  ).get(ledgerId) as
    | { ledger_entry_id: string; remaining_amount: number; status: string }
    | undefined;
}

async function balance(): Promise<number> {
  return (await getMileageSummaryForFriend(db, 'fa-1')).available;
}

let rewardSeq = 0;
async function makePublishedRewardId(requiredMiles: number): Promise<string> {
  rewardSeq += 1;
  const draft = await createMileageRewardDraft(db, {
    lineAccountId: 'acc-a',
    draft: {
      name: `特典${rewardSeq}`,
      rewardKind: 'coupon',
      requiredMiles,
      customerMessage: 'どうぞ',
    },
  });
  await importMileageRewardCodes(db, {
    rewardId: draft.id,
    lineAccountId: 'acc-a',
    codes: [{ ciphertext: `encrypted-${rewardSeq}`, fingerprint: `fp-${rewardSeq}` }],
  });
  await publishMileageReward(db, { id: draft.id, lineAccountId: 'acc-a' });
  return draft.id;
}

describe('R359 手動減算と付与内訳の一致', () => {
  it('減算すると残高と使用可能ロットが同じだけ減る', async () => {
    const seedEntry = await grant(200, { key: 'seed' });
    expect(lotOf(seedEntry.id)).toMatchObject({ remaining_amount: 200, status: 'available' });

    const result = await adjust(-100, { idempotencyKey: 'adj-once' });
    expect(result).toMatchObject({ balanceBefore: 200, balanceAfter: 100, replayed: false });

    expect(await balance()).toBe(100);
    expect(usableLotsTotal()).toBe(100);
    expect(lotOf(seedEntry.id)).toMatchObject({ remaining_amount: 100, status: 'available' });
  });

  it('複数ロットは期限の近い順に消費する', async () => {
    const soon = new Date(Date.now() + 30 * 86400_000).toISOString();
    const later = new Date(Date.now() + 60 * 86400_000).toISOString();
    const first = await grant(100, { key: 'g-first', expiresAt: soon });
    const second = await grant(100, { key: 'g-second', expiresAt: later });

    await adjust(-150, {
      idempotencyKey: 'adj-fifo',
      occurredAt: '2026-09-02T00:00:00.000+09:00',
    });

    expect(await balance()).toBe(50);
    expect(usableLotsTotal()).toBe(50);
    expect(lotOf(first.id)).toMatchObject({ remaining_amount: 0, status: 'exhausted' });
    expect(lotOf(second.id)).toMatchObject({ remaining_amount: 50, status: 'available' });
  });

  it('取消すると取り消した付与のロットは使用不可になる', async () => {
    const increased = await adjust(100, { idempotencyKey: 'adj-up' });
    expect(lotOf(increased.entry.id)).toMatchObject({
      remaining_amount: 100,
      status: 'available',
    });

    await voidMileageLedgerEntry(db, {
      entryId: increased.entry.id,
      lineAccountId: 'acc-a',
      staffId: 'staff-1',
      staffName: '担当者',
      reason: '誤付与のため',
    });

    expect(await balance()).toBe(0);
    expect(usableLotsTotal()).toBe(0);
    expect(lotOf(increased.entry.id)?.status).not.toBe('available');

    const again = await voidMileageLedgerEntry(db, {
      entryId: increased.entry.id,
      lineAccountId: 'acc-a',
      staffId: 'staff-1',
      staffName: '担当者',
      reason: '誤付与のため',
    });
    expect(again.replayed).toBe(true);
    expect(lotOf(increased.entry.id)).toMatchObject({ remaining_amount: 0 });
    expect(
      (
        sqlite.prepare(
          `SELECT COUNT(*) AS n FROM mileage_ledger WHERE reverses_entry_id = ?`,
        ).get(increased.entry.id) as { n: number }
      ).n,
    ).toBe(1);

    const rewardId = await makePublishedRewardId(60);
    await expect(
      reserveMileageRewardRedemption(db, {
        lineAccountId: 'acc-a',
        friendId: 'fa-1',
        rewardId,
        idempotencyKey: 'redeem-voided',
        requestFingerprint: 'fp-voided',
      }),
    ).rejects.toBeInstanceOf(MileageRewardError);
  });

  it('再試行はロットを二重に消費しない', async () => {
    await grant(200, { key: 'seed-retry' });
    const input = {
      friendId: 'fa-1',
      amount: -100,
      reason: '手動調整',
      reasonCategory: 'grant_correction',
      idempotencyKey: 'adj-retry',
      executedByStaffId: 'staff-1',
      executedByStaffName: '担当者',
      lineAccountId: 'acc-a',
    } as const;

    const first = await postMileageAdjustment(db, input);
    const second = await postMileageAdjustment(db, input);
    expect(second.replayed).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);

    expect(await balance()).toBe(100);
    expect(usableLotsTotal()).toBe(100);
    expect(
      (
        sqlite.prepare(
          `SELECT COUNT(*) AS n FROM mileage_ledger WHERE entry_type = 'adjustment' AND amount < 0`,
        ).get() as { n: number }
      ).n,
    ).toBe(1);
  });

  it('同時操作は勝者だけが残高とロットを動かす', async () => {
    await grant(100, { key: 'seed-race' });
    const make = (key: string) =>
      adjust(-80, { idempotencyKey: key, reason: '同時調整' });
    const results = await Promise.allSettled([make('race-a'), make('race-b')]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'insufficient_balance' });

    expect(await balance()).toBe(20);
    expect(usableLotsTotal()).toBe(20);
  });

  it('境界値：残高ちょうどは使い切り、超えると止まりロットは動かない', async () => {
    await grant(100, { key: 'seed-edge' });

    await adjust(-100, { idempotencyKey: 'adj-exact' });
    expect(await balance()).toBe(0);
    expect(usableLotsTotal()).toBe(0);

    await grant(50, { key: 'seed-edge-2' });
    await expect(adjust(-51, { idempotencyKey: 'adj-over' })).rejects.toMatchObject({
      code: 'insufficient_balance',
    });
    expect(await balance()).toBe(50);
    expect(usableLotsTotal()).toBe(50);

    await expect(adjust(0, { idempotencyKey: 'adj-zero' })).rejects.toThrow();
    expect(await balance()).toBe(50);
    expect(usableLotsTotal()).toBe(50);
  });

  it('減算後の交換は減った内訳で成功し、超える分は不足になる', async () => {
    await grant(200, { key: 'seed-redeem' });
    await adjust(-100, { idempotencyKey: 'adj-before-redeem' });

    const okRewardId = await makePublishedRewardId(60);
    const { redemption } = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'acc-a',
      friendId: 'fa-1',
      rewardId: okRewardId,
      idempotencyKey: 'redeem-ok',
      requestFingerprint: 'fp-ok',
    });
    expect(redemption.status).toBe('reserved');
    const allocated = (
      sqlite.prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM mileage_spend_allocations
          WHERE redemption_id = ?`,
      ).get(redemption.id) as { total: number }
    ).total;
    expect(Number(allocated)).toBe(60);

    const ngRewardId = await makePublishedRewardId(150);
    await expect(
      reserveMileageRewardRedemption(db, {
        lineAccountId: 'acc-a',
        friendId: 'fa-1',
        rewardId: ngRewardId,
        idempotencyKey: 'redeem-ng',
        requestFingerprint: 'fp-ng',
      }),
    ).rejects.toMatchObject({ code: 'insufficient_miles' });
  });

  it('複数ロットにまたがる同時減算は両方通っても残高と内訳が一致する', async () => {
    await grant(100, { key: 'seed-multi-a' });
    await grant(100, { key: 'seed-multi-b' });
    const results = await Promise.allSettled([
      adjust(-80, { idempotencyKey: 'race-multi-a', reason: '同時調整A' }),
      adjust(-80, { idempotencyKey: 'race-multi-b', reason: '同時調整B' }),
    ]);

    // 残高は両方を通す（200 - 160 = 40）。
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await balance()).toBe(40);
    // 内訳も同じだけ減る。負けた側が古い内訳で同じロットを触っても、
    // 取り直した残りから消費し直すため、合計は残高と一致する。
    expect(usableLotsTotal()).toBe(40);
  });
});
