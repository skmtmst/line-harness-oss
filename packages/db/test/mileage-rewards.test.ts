import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimRedemptionStep,
  clearRedemptionStepIntent,
  createMileageRewardDraft,
  getMileageReward,
  importMileageRewardCodes,
  listMileageRedemptions,
  markRedemptionStepSent,
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

/*
 * 移行の再生は全部同期で走る。テストごとに繰り返すとその間ワーカーが
 * 止まり、CI が vitest の状況報告待ちで落ちる。1度だけ組み立てて中身を
 * 控え、以後は写しから起こす。写しは独立したDBなので、テスト同士は
 * 影響し合わない。
 */
let migratedSnapshot: Buffer | null = null;

function setupSqlite() {
  if (migratedSnapshot) return new Database(migratedSnapshot);
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
  migratedSnapshot = db.serialize();
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
      draft: {
        name: '旧特典', rewardKind: 'coupon', requiredMiles: 300,
        targetConditions: {
          operator: 'AND',
          rules: [{ type: 'tag_exists', value: '会員' }],
        },
      },
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
    expect(next.currentVersion?.targetConditions).toEqual({
      operator: 'AND', rules: [{ type: 'tag_exists', value: '会員' }],
    });
    await updateMileageRewardDraft(db, {
      id: draft.id,
      lineAccountId: 'account-1',
      expectedVersionId: next.currentDraftVersionId!,
      draft: { name: '新特典', rewardKind: 'coupon', requiredMiles: 500 },
    });
    const edited = await getMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
    expect(edited?.currentVersion).toMatchObject({ status: 'draft', requiredMiles: 500 });
    expect(sqlite.prepare(
      `SELECT required_miles, target_conditions FROM mileage_reward_versions WHERE id = ?`,
    ).get(published.currentPublishedVersionId)).toEqual({
      required_miles: 300,
      target_conditions: '{"operator":"AND","rules":[{"type":"tag_exists","value":"会員"}]}',
    });
  });

  it('lists failed redemptions with reason, attempts, and timestamps, isolated by account', async () => {
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: { name: '500円引き', rewardKind: 'coupon', requiredMiles: 300 },
    });
    await importMileageRewardCodes(db, {
      rewardId: draft.id, lineAccountId: 'account-1',
      codes: [{ ciphertext: 'encrypted-code', fingerprint: 'fingerprint-1' }],
    });
    await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
      idempotencyKey: 'redeem-list', requestFingerprint: 'fp-list',
    });
    // 失敗を注入する。本物と同じく残高は減ったまま、特典だけ届いていない。
    await recordMileageRedemptionAttempt(db, {
      redemptionId: reserved.redemption.id,
      status: 'failed',
      errorCode: 'reward_delivery_failed',
      errorMessage: '特典を渡せませんでした',
    });

    const failed = await listMileageRedemptions(db, { lineAccountId: 'account-1', limit: 20, offset: 0 });
    expect(failed.pagination).toMatchObject({ total: 1, limit: 20, offset: 0 });
    expect(failed.items).toHaveLength(1);
    expect(failed.items[0]).toMatchObject({
      id: reserved.redemption.id,
      status: 'delivery_failed',
      attemptCount: 1,
      failureCode: 'reward_delivery_failed',
      failureMessage: '特典を渡せませんでした',
      rewardName: '500円引き',
    });
    expect(typeof failed.items[0].updatedAt).toBe('string');

    // 別の店からは見えない。成功の絞り込みにも出ない。全件には出る。
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-2', 'channel-2', '公式B', 'token', 'secret')`,
    ).run();
    const hidden = await listMileageRedemptions(db, { lineAccountId: 'account-2', limit: 20, offset: 0 });
    expect(hidden).toMatchObject({ items: [], pagination: { total: 0 } });
    const succeeded = await listMileageRedemptions(db, {
      lineAccountId: 'account-1', status: 'succeeded', limit: 20, offset: 0,
    });
    expect(succeeded).toMatchObject({ items: [], pagination: { total: 0 } });
    const all = await listMileageRedemptions(db, {
      lineAccountId: 'account-1', status: 'all', limit: 20, offset: 0,
    });
    expect(all.pagination.total).toBe(1);
  });

  it('continues the same redemption on retry without deducting mileage again', async () => {
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: { name: '500円引き', rewardKind: 'coupon', requiredMiles: 300 },
    });
    await importMileageRewardCodes(db, {
      rewardId: draft.id, lineAccountId: 'account-1',
      codes: [{ ciphertext: 'encrypted-code', fingerprint: 'fingerprint-1' }],
    });
    await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
      idempotencyKey: 'redeem-retry', requestFingerprint: 'fp-retry',
    });
    // 1回目の配送が失敗する。
    await recordMileageRedemptionAttempt(db, {
      redemptionId: reserved.redemption.id,
      status: 'failed',
      errorCode: 'reward_delivery_failed',
      errorMessage: '特典を渡せませんでした',
    });
    // やり直しの配送が成功する。同じ交換IDのまま、残高はもう減らない。
    const retried = await recordMileageRedemptionAttempt(db, {
      redemptionId: reserved.redemption.id, status: 'succeeded',
    });
    expect(retried).toMatchObject({ id: reserved.redemption.id, status: 'succeeded', attemptCount: 2 });
    expect(sqlite.prepare(
      `SELECT available FROM mileage_wallets WHERE program_id = 'default' AND beneficiary_key = 'user:user-1'`,
    ).get()).toEqual({ available: 700 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM mileage_ledger WHERE entry_type = 'spend'`).get())
      .toEqual({ count: 1 });
    // 成功した交換は失敗の一覧から消える。
    const failed = await listMileageRedemptions(db, { lineAccountId: 'account-1', limit: 20, offset: 0 });
    expect(failed).toMatchObject({ items: [], pagination: { total: 0 } });
  });

  it('marks a sent step so a retry skips it instead of resending', async () => {
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: { name: '500円引き', rewardKind: 'coupon', requiredMiles: 300 },
    });
    await importMileageRewardCodes(db, {
      rewardId: draft.id, lineAccountId: 'account-1',
      codes: [{ ciphertext: 'encrypted-code', fingerprint: 'fingerprint-1' }],
    });
    await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
      idempotencyKey: 'redeem-step', requestFingerprint: 'fp-step',
    });
    const lease = (owner: string, fenceToken: string, now: string) => ({
      redemptionId: reserved.redemption.id, stepKey: '0:w1', idempotencyKey: 'step-key-1',
      owner, fenceToken, leaseExpiresAt: '2026-09-09T00:05:00.000Z', now,
    });
    expect(await claimRedemptionStep(db, lease('owner-a', 'fence-a1', '2026-09-09T00:00:00.000Z'))).toBe('send');
    // 証言つきの貸出中の別走者は、送らずに待つ(照合待ち)。
    expect(await claimRedemptionStep(db, lease('owner-b', 'fence-b1', '2026-09-09T00:01:00.000Z'))).toBe('reconcile');
    await markRedemptionStepSent(db, {
      redemptionId: reserved.redemption.id, stepKey: '0:w1',
      owner: 'owner-a', fenceToken: 'fence-a1', now: '2026-09-09T00:02:00.000Z',
    });
    // 送り済みは二度目を送らない。確保していない確定は投げる。
    expect(await claimRedemptionStep(db, lease('owner-b', 'fence-b2', '2026-09-09T00:03:00.000Z'))).toBe('sent');
    await expect(markRedemptionStepSent(db, {
      redemptionId: reserved.redemption.id, stepKey: '0:missing',
      owner: 'owner-a', fenceToken: 'fence-a1', now: '2026-09-09T00:03:00.000Z',
    })).rejects.toMatchObject({ name: 'MileageRedemptionConfirmError' });
  });

  it('clears the intent only for a pre-send failure and blocks confirming it', async () => {
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: { name: '500円引き', rewardKind: 'coupon', requiredMiles: 300 },
    });
    await importMileageRewardCodes(db, {
      rewardId: draft.id, lineAccountId: 'account-1',
      codes: [{ ciphertext: 'encrypted-code', fingerprint: 'fingerprint-4' }],
    });
    await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
      idempotencyKey: 'redeem-step-clear', requestFingerprint: 'fp-step-clear',
    });
    const lease = (owner: string, fenceToken: string, now: string) => ({
      redemptionId: reserved.redemption.id, stepKey: '0:w1', idempotencyKey: 'step-key-4',
      owner, fenceToken, leaseExpiresAt: '2026-09-09T00:05:00.000Z', now,
    });
    // 確保と同時に証言が残る。送る前に失敗したら証言を消せる。
    expect(await claimRedemptionStep(db, lease('owner-a', 'fence-a1', '2026-09-09T00:00:00.000Z'))).toBe('send');
    expect(sqlite.prepare(
      `SELECT needs_reconcile AS needsReconcile FROM mileage_redemption_step_deliveries
        WHERE redemption_id = ? AND step_key = '0:w1'`,
    ).get(reserved.redemption.id)).toEqual({ needsReconcile: 1 });
    await clearRedemptionStepIntent(db, {
      redemptionId: reserved.redemption.id, stepKey: '0:w1',
      owner: 'owner-a', fenceToken: 'fence-a1', now: '2026-09-09T00:01:00.000Z',
    });
    /*
     * 証言を消したら**貸出も返っている**。持ち主と期限を残すと、行は
     * 「送っていないのに誰かが送信中」に見え、次の走者は貸出が切れるまで
     * `'busy'` しか受け取れない。失敗した直後の管理画面のやり直しが
     * 貸出の残り時間ぶん空振りする(#641 司令塔独立審査で実測)。
     */
    expect(sqlite.prepare(
      `SELECT owner, lease_expires_at AS leaseExpiresAt, needs_reconcile AS needsReconcile
         FROM mileage_redemption_step_deliveries
        WHERE redemption_id = ? AND step_key = '0:w1'`,
    ).get(reserved.redemption.id)).toEqual({
      owner: null, leaseExpiresAt: null, needsReconcile: 0,
    });
    // 送っていないことが決まっているので、次の走者は貸出中でも送れる。
    expect(await claimRedemptionStep(db, lease('owner-b', 'fence-b1', '2026-09-09T00:02:00.000Z'))).toBe('send');
    // 引き継ぎなので世代が進み、持ち主が替わっている。
    expect(sqlite.prepare(
      `SELECT owner, generation, needs_reconcile AS needsReconcile
         FROM mileage_redemption_step_deliveries
        WHERE redemption_id = ? AND step_key = '0:w1'`,
    ).get(reserved.redemption.id)).toEqual({
      owner: 'owner-b', generation: 2, needsReconcile: 1,
    });
    // 証言を消した古い走者の確定は通らない(送っていないので確定できない)。
    await expect(markRedemptionStepSent(db, {
      redemptionId: reserved.redemption.id, stepKey: '0:w1',
      owner: 'owner-a', fenceToken: 'fence-a1', now: '2026-09-09T00:02:00.000Z',
    })).rejects.toMatchObject({ name: 'MileageRedemptionConfirmError' });
    // 証言消しは一度きり。古い走者は二度目を通せない。
    await expect(clearRedemptionStepIntent(db, {
      redemptionId: reserved.redemption.id, stepKey: '0:w1',
      owner: 'owner-a', fenceToken: 'fence-a1', now: '2026-09-09T00:03:00.000Z',
    })).rejects.toMatchObject({ name: 'MileageRedemptionConfirmError' });
    // 引き継いだ走者が持っている間は、さらに別の走者は送れない。
    expect(await claimRedemptionStep(db, lease('owner-c', 'fence-c1', '2026-09-09T00:04:00.000Z'))).toBe('reconcile');
  });

  it('takes over an expired lease with a new generation and rejects the slow old owner', async () => {
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: { name: '500円引き', rewardKind: 'coupon', requiredMiles: 300 },
    });
    await importMileageRewardCodes(db, {
      rewardId: draft.id, lineAccountId: 'account-1',
      codes: [{ ciphertext: 'encrypted-code', fingerprint: 'fingerprint-2' }],
    });
    await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
      idempotencyKey: 'redeem-step-takeover', requestFingerprint: 'fp-step-takeover',
    });
    const lease = (owner: string, fenceToken: string, now: string) => ({
      redemptionId: reserved.redemption.id, stepKey: '0:w1', idempotencyKey: 'step-key-2',
      owner, fenceToken, leaseExpiresAt: '2026-09-09T00:05:00.000Z', now,
    });
    expect(await claimRedemptionStep(db, lease('owner-a', 'fence-a1', '2026-09-09T00:00:00.000Z'))).toBe('send');
    // 旧持ち主は送る前に失敗し、証言を消して倒れたとする。
    await clearRedemptionStepIntent(db, {
      redemptionId: reserved.redemption.id, stepKey: '0:w1',
      owner: 'owner-a', fenceToken: 'fence-a1', now: '2026-09-09T00:01:00.000Z',
    });
    // 貸出期限を過ぎたら別走者が引き継ぎ、世代が進む。
    expect(await claimRedemptionStep(db, {
      ...lease('owner-b', 'fence-b1', '2026-09-09T01:00:00.000Z'),
      leaseExpiresAt: '2026-09-09T01:05:00.000Z',
    })).toBe('send');
    expect(sqlite.prepare(
      `SELECT owner, generation FROM mileage_redemption_step_deliveries
        WHERE redemption_id = ? AND step_key = '0:w1'`,
    ).get(reserved.redemption.id)).toEqual({ owner: 'owner-b', generation: 2 });
    // 遅れてきた旧持ち主の確定は通らない。
    await expect(markRedemptionStepSent(db, {
      redemptionId: reserved.redemption.id, stepKey: '0:w1',
      owner: 'owner-a', fenceToken: 'fence-a1', now: '2026-09-09T01:01:00.000Z',
    })).rejects.toMatchObject({ name: 'MileageRedemptionConfirmError' });
    // 期限切れの旧持ち主が貸出を取り直しても、送り直しは許さない。
    expect(await claimRedemptionStep(db, {
      ...lease('owner-a', 'fence-a2', '2026-09-09T01:01:00.000Z'),
      leaseExpiresAt: '2026-09-09T01:06:00.000Z',
    })).toBe('reconcile');
    await markRedemptionStepSent(db, {
      redemptionId: reserved.redemption.id, stepKey: '0:w1',
      owner: 'owner-b', fenceToken: 'fence-b1', now: '2026-09-09T01:02:00.000Z',
    });
  });

  it('waits on an uncertain step without resending or confirming it', async () => {
    const draft = await createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: { name: '500円引き', rewardKind: 'coupon', requiredMiles: 300 },
    });
    await importMileageRewardCodes(db, {
      rewardId: draft.id, lineAccountId: 'account-1',
      codes: [{ ciphertext: 'encrypted-code', fingerprint: 'fingerprint-3' }],
    });
    await publishMileageReward(db, { id: draft.id, lineAccountId: 'account-1' });
    const reserved = await reserveMileageRewardRedemption(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', rewardId: draft.id,
      idempotencyKey: 'redeem-step-unknown', requestFingerprint: 'fp-step-unknown',
    });
    const lease = (owner: string, fenceToken: string, now: string) => ({
      redemptionId: reserved.redemption.id, stepKey: '0:w1', idempotencyKey: 'step-key-3',
      owner, fenceToken, leaseExpiresAt: '2026-09-09T00:05:00.000Z', now,
    });
    // 確保と同時に証言が残る。以降は誰も送り直さないし確定もしない。
    expect(await claimRedemptionStep(db, lease('owner-a', 'fence-a1', '2026-09-09T00:00:00.000Z'))).toBe('send');
    expect(await claimRedemptionStep(db, lease('owner-b', 'fence-b1', '2026-09-09T00:02:00.000Z'))).toBe('reconcile');
    // 期限切れの旧持ち主が取り直しても、貸出は戻らず照合待ちのまま。
    expect(await claimRedemptionStep(db, {
      ...lease('owner-a', 'fence-a2', '2026-09-09T01:00:00.000Z'),
      leaseExpiresAt: '2026-09-09T01:05:00.000Z',
    })).toBe('reconcile');
    expect(await claimRedemptionStep(db, {
      ...lease('owner-b', 'fence-b2', '2026-09-09T01:00:00.000Z'),
      leaseExpiresAt: '2026-09-09T01:05:00.000Z',
    })).toBe('reconcile');
    expect(sqlite.prepare(
      `SELECT status, needs_reconcile AS needsReconcile, generation
         FROM mileage_redemption_step_deliveries WHERE redemption_id = ? AND step_key = '0:w1'`,
    ).get(reserved.redemption.id)).toEqual({ status: 'started', needsReconcile: 1, generation: 1 });
  });

  it('rejects unsupported or more than 15 reward target conditions', async () => {
    await expect(createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: {
        name: '不正な条件', rewardKind: 'coupon', requiredMiles: 300,
        targetConditions: { operator: 'AND', rules: [{ type: 'unknown', value: true }] },
      },
    })).rejects.toMatchObject({ code: 'target_condition_type_invalid' });

    await expect(createMileageRewardDraft(db, {
      lineAccountId: 'account-1',
      draft: {
        name: '多すぎる条件', rewardKind: 'coupon', requiredMiles: 300,
        targetConditions: {
          operator: 'OR',
          rules: Array.from({ length: 16 }, (_, index) => ({ type: 'tag_exists', value: `tag-${index}` })),
        },
      },
    })).rejects.toMatchObject({ code: 'target_conditions_too_many' });
  });
});
