import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMileageRewardDraft,
  getMileageReward,
  importMileageRewardCodes,
  publishMileageReward,
  recordMileageRedemptionAttempt,
  refundMileageRewardRedemption,
  reserveMileageRewardRedemption,
  setMileageRewardStatus,
  updateMileageRewardDraft,
} from '../src/mileage-rewards.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BENIGN = /duplicate column name|already exists/i;

function execSafe(db: Database.Database, sql: string) {
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) {
    try { db.exec(statement); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!BENIGN.test(message)) throw error;
    }
  }
}

function setupSqlite() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  execSafe(db, readFileSync(join(PACKAGE_ROOT, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(join(PACKAGE_ROOT, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    execSafe(db, readFileSync(join(PACKAGE_ROOT, 'migrations', file), 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, display_name) VALUES ('user-1', 'マイル利用者')`).run();
  db.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', '公式A', 'token', 'secret')`,
  ).run();
  db.prepare(
    `INSERT INTO friends
       (id, line_user_id, display_name, picture_url, user_id, line_account_id)
     VALUES ('friend-1', 'U1', '利用者A', NULL, 'user-1', 'account-1')`,
  ).run();
  db.prepare(
    `INSERT INTO mileage_ledger
       (id, program_id, beneficiary_user_id, beneficiary_friend_id, entry_type, status,
        amount, reason, source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
     VALUES ('grant-1', 'default', 'user-1', 'friend-1', 'grant', 'available',
             1000, '初期付与', 'test', 'event-1', 'grant-1', '{"expiresAt":"2027-01-01T00:00:00.000Z"}',
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
  ).run();
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  const prepare = (sql: string) => ({
    bind(...params: unknown[]) {
      const statement = sqlite.prepare(sql);
      return {
        async run() {
          const result = statement.run(...params);
          return { success: true, results: [], meta: { changes: result.changes } };
        },
        async first<T>() { return (statement.get(...params) as T) ?? null; },
        async all<T>() { return { success: true, results: statement.all(...params) as T[], meta: {} }; },
        _statement: statement,
        _params: params,
      };
    },
  });
  return {
    prepare,
    async batch(statements: unknown[]) {
      return sqlite.transaction(() => statements.map((raw) => {
        const item = raw as {
          _statement: Database.Statement;
          _params: unknown[];
        };
        const result = item._statement.run(...item._params);
        return { success: true, results: [], meta: { changes: result.changes } };
      }))();
    },
  } as unknown as D1Database;
}

describe('V6 mileage rewards', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = setupSqlite();
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('publishes an immutable coupon version only after inventory is registered', async () => {
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: {
        name: '送料無料', rewardKind: 'coupon', requiredMiles: 300,
        customerMessage: '交換コードをお使いください',
      },
    });
    await expect(publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' }))
      .rejects.toMatchObject({ code: 'coupon_inventory_empty' });

    await importMileageRewardCodes(db, {
      rewardId: draft.id,
      lineAccountId: 'account-1',
      codes: [{ ciphertext: 'encrypted-code', fingerprint: 'fingerprint-1' }],
    });
    const published = await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
    expect(published).toMatchObject({ status: 'published', currentDraftVersionId: null });
    expect(published.currentVersion).toMatchObject({ status: 'published', requiredMiles: 300 });

    expect(() => sqlite.prepare(
      `UPDATE mileage_reward_versions SET required_miles = 1 WHERE id = ?`,
    ).run(published.currentPublishedVersionId)).toThrow(/immutable/);
  });

  it('deducts mileage once, reserves one code, and returns the same redemption on retry', async () => {
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: { name: '500円引き', rewardKind: 'coupon', requiredMiles: 300 },
    });
    await importMileageRewardCodes(db, {
      rewardId: draft.id,
      lineAccountId: 'account-1',
      codes: [{ ciphertext: 'encrypted-code', fingerprint: 'fingerprint-1' }],
    });
    await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });

    const first = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
      idempotencyKey: 'redeem-1', requestFingerprint: 'fp-1',
    });
    const replay = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
      idempotencyKey: 'redeem-1', requestFingerprint: 'fp-1',
    });
    expect(first.kind).toBe('created');
    expect(replay).toMatchObject({ kind: 'existing', redemption: { id: first.redemption.id } });
    expect(sqlite.prepare(
      `SELECT available FROM mileage_wallets WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 700 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM mileage_ledger WHERE entry_type = 'spend'`).get())
      .toEqual({ count: 1 });
    expect(sqlite.prepare(`SELECT status FROM mileage_reward_codes`).get()).toEqual({ status: 'reserved' });

    await expect(reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
      idempotencyKey: 'redeem-1', requestFingerprint: 'different',
    })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('allows only one concurrent exchange to reserve the last coupon code', async () => {
    sqlite.prepare(`INSERT INTO users (id, display_name) VALUES ('user-2', 'マイル利用者2')`).run();
    sqlite.prepare(
      `INSERT INTO friends
         (id, line_user_id, display_name, picture_url, user_id, line_account_id)
       VALUES ('friend-2', 'U2', '利用者B', NULL, 'user-2', 'account-1')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO mileage_ledger
         (id, program_id, beneficiary_user_id, beneficiary_friend_id, entry_type, status,
          amount, reason, source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
       VALUES ('grant-2', 'default', 'user-2', 'friend-2', 'grant', 'available',
               1000, '初期付与', 'test', 'event-2', 'grant-2', '{}',
               '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
    ).run();
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: { name: '最後の1枚', rewardKind: 'coupon', requiredMiles: 300 },
    });
    await importMileageRewardCodes(db, {
      rewardId: draft.id,
      lineAccountId: 'account-1',
      codes: [{ ciphertext: 'last-code', fingerprint: 'last-code' }],
    });
    await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });

    let arrivals = 0;
    let release!: () => void;
    const bothReady = new Promise<void>((resolve) => { release = resolve; });
    const racingDb = {
      prepare: db.prepare.bind(db),
      async batch(statements: D1PreparedStatement[]) {
        arrivals += 1;
        if (arrivals === 2) release();
        await bothReady;
        return db.batch(statements);
      },
    } as unknown as D1Database;
    const results = await Promise.allSettled([
      reserveMileageRewardRedemption(racingDb, {
        lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
        idempotencyKey: 'race-1', requestFingerprint: 'race-fp-1',
      }),
      reserveMileageRewardRedemption(racingDb, {
        lineAccountId: 'account-1', friendId: 'friend-2', rewardId: draft.id,
        idempotencyKey: 'race-2', requestFingerprint: 'race-fp-2',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')[0]).toMatchObject({
      reason: { code: 'out_of_stock' },
    });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM mileage_redemptions`).get()).toEqual({ count: 1 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM mileage_ledger WHERE entry_type = 'spend'`).get())
      .toEqual({ count: 1 });
  });

  it('records delivery failure and restores mileage through an append-only refund', async () => {
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: { name: '限定コード', rewardKind: 'coupon', requiredMiles: 400 },
    });
    await importMileageRewardCodes(db, {
      rewardId: draft.id, lineAccountId: 'account-1',
      codes: [{ ciphertext: 'encrypted-code', fingerprint: 'fingerprint-1' }],
    });
    await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
      idempotencyKey: 'redeem-failure', requestFingerprint: 'fp-failure',
    });
    const failed = await recordMileageRedemptionAttempt(db, {
      redemptionId: reserved.redemption.id,
      status: 'failed',
      errorCode: 'delivery_failed',
      errorMessage: '特典を渡せませんでした',
    });
    expect(failed).toMatchObject({ status: 'delivery_failed', attemptCount: 1 });

    const refunded = await refundMileageRewardRedemption(db, {
      redemptionId: failed.id,
      reason: '配布に失敗したためマイルを戻す',
    });
    expect(refunded.status).toBe('refunded');
    expect(sqlite.prepare(
      `SELECT available FROM mileage_wallets WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 1000 });
    expect(sqlite.prepare(
      `SELECT entry_type, amount FROM mileage_ledger WHERE source = 'mileage_reward_refund'`,
    ).get()).toEqual({ entry_type: 'reversal', amount: 400 });
    expect(sqlite.prepare(`SELECT status FROM mileage_reward_codes`).get()).toEqual({ status: 'available' });

    // 返金は残高だけでなく、先に使った付与ロットも戻す。ここが戻らないと、
    // 表示上は1000マイルなのに次の交換だけが失敗する。
    const second = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
      idempotencyKey: 'redeem-after-refund', requestFingerprint: 'fp-after-refund',
    });
    expect(second.kind).toBe('created');
    expect(sqlite.prepare(
      `SELECT available FROM mileage_wallets WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 600 });
  });

  it('keeps the previous published version active while a new draft is edited', async () => {
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: { name: '旧特典', rewardKind: 'coupon', requiredMiles: 300 },
    });
    await importMileageRewardCodes(db, {
      rewardId: draft.id, lineAccountId: 'account-1',
      codes: [{ ciphertext: 'code-v1', fingerprint: 'code-v1' }],
    });
    const published = await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
    await setMileageRewardStatus(db, { id: draft.id, lineAccountId: 'account-1', status: 'stopped' });
    expect((await getMileageReward(db, { id: draft.id, lineAccountId: 'account-1' }))?.status).toBe('stopped');

    const { createMileageRewardDraftFromPublished } = await import('../src/mileage-rewards.js');
    const next = await createMileageRewardDraftFromPublished(db, {
      id: draft.id, lineAccountId: 'account-1',
    });
    expect(next.currentPublishedVersionId).toBe(published.currentPublishedVersionId);
    expect(next.currentDraftVersionId).not.toBeNull();
    await updateMileageRewardDraft(db, {
      id: draft.id,
      lineAccountId: 'account-1',
      expectedVersionId: next.currentDraftVersionId!,
      draft: { name: '新特典', rewardKind: 'coupon', requiredMiles: 500 },
    });
    const edited = await getMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
    expect(edited?.currentVersion).toMatchObject({ status: 'draft', requiredMiles: 500 });
    expect(sqlite.prepare(
      `SELECT required_miles FROM mileage_reward_versions WHERE id = ?`,
    ).get(published.currentPublishedVersionId)).toEqual({ required_miles: 300 });
  });
});
