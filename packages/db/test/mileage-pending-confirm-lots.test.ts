/**
 * 確定待ちの確定と付与内訳の一致（m25d R359 の続き）。
 *
 * 確定待ち（pending）の付与は INSERT 時の trigger が内訳（mileage_grant_lots）
 * を作らず、確定（confirmPendingMileageEntry）は UPDATE のため trigger が
 * 発火しない。財布（mileage_wallets）の利用可能分も動かない。結果として
 * 「残高100・使える内訳0」になり、交換が不足として止まる。
 * 確定・再送・確定待ちの取消を隔離試験で守る恒久試験。
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMileageSummaryForFriend, postMileageEntry } from '../src/mileage.js';
import { confirmPendingMileageEntry, voidMileageLedgerEntry } from '../src/mileage-approvals.js';
import {
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

async function grantPending(amount = 100, expiresAt?: string) {
  seq += 1;
  return postMileageEntry(db, {
    beneficiaryUserId: 'user-1',
    beneficiaryFriendId: 'fa-1',
    entryType: 'grant',
    status: 'pending',
    amount,
    reason: '予約の付与',
    source: 'booking',
    sourceEventId: `booking-${seq}`,
    idempotencyKey: `pending-grant-${seq}`,
    occurredAt: '2026-09-01T00:00:00.000+09:00',
    ...(expiresAt ? { metadata: { expiresAt } } : {}),
  });
}

function confirm(entryId: string) {
  return confirmPendingMileageEntry(db, {
    entryId,
    lineAccountId: 'acc-a',
    staffId: 'staff-1',
    staffName: '担当者',
    reason: '来店を確認した',
  });
}

function wallet() {
  return sqlite.prepare(
    `SELECT available, pending FROM mileage_wallets
      WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
  ).get() as { available: number; pending: number } | undefined;
}

function lotOf(ledgerId: string) {
  return sqlite.prepare(
    `SELECT ledger_entry_id, remaining_amount, status, expires_at FROM mileage_grant_lots
      WHERE ledger_entry_id = ?`,
  ).get(ledgerId) as
    | { ledger_entry_id: string; remaining_amount: number; status: string; expires_at: string | null }
    | undefined;
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

describe('確定待ちの確定と付与内訳の一致', () => {
  it('確定すると残高・財布・内訳がそろい交換できる', async () => {
    const entry = await grantPending();
    expect(lotOf(entry.id)).toBeUndefined();

    const { entry: confirmed, alreadyConfirmed } = await confirm(entry.id);
    expect(alreadyConfirmed).toBe(false);
    expect(confirmed.status).toBe('available');

    expect((await getMileageSummaryForFriend(db, 'fa-1')).available).toBe(100);
    expect(wallet()).toMatchObject({ available: 100, pending: 0 });
    expect(lotOf(entry.id)).toMatchObject({ remaining_amount: 100, status: 'available' });

    const rewardId = await makePublishedRewardId(60);
    const { redemption } = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'acc-a',
      friendId: 'fa-1',
      rewardId,
      idempotencyKey: 'redeem-confirmed',
      requestFingerprint: 'fp-confirmed',
    });
    expect(redemption.status).toBe('reserved');
  });

  it('期限つきの確定待ちは内訳の期限を引き継ぐ', async () => {
    const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
    const entry = await grantPending(100, expiresAt);
    await confirm(entry.id);

    expect(lotOf(entry.id)).toMatchObject({ remaining_amount: 100, status: 'available' });
    expect(lotOf(entry.id)?.expires_at).toBe(expiresAt);
  });

  it('確定の再送は財布と内訳を二重に動かさない', async () => {
    const entry = await grantPending();
    await confirm(entry.id);
    const again = await confirm(entry.id);

    expect(again.alreadyConfirmed).toBe(true);
    expect(wallet()).toMatchObject({ available: 100, pending: 0 });
    expect(lotOf(entry.id)).toMatchObject({ remaining_amount: 100 });
    expect(
      (
        sqlite.prepare(
          `SELECT COUNT(*) AS n FROM mileage_ledger WHERE program_id = 'default'`,
        ).get() as { n: number }
      ).n,
    ).toBe(1);
  });

  it('確定待ちの取消では内訳は作られない', async () => {
    const entry = await grantPending();
    await voidMileageLedgerEntry(db, {
      entryId: entry.id,
      lineAccountId: 'acc-a',
      staffId: 'staff-1',
      staffName: '担当者',
      reason: '予約を取り消した',
    });

    const summary = await getMileageSummaryForFriend(db, 'fa-1');
    expect(summary.available).toBe(0);
    expect(summary.pending).toBe(0);
    expect(lotOf(entry.id)).toBeUndefined();
  });
});
