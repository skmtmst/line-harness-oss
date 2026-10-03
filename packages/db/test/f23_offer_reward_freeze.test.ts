import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  createAffiliateOffer,
  createOfferVersion,
  getAffiliateOfferById,
  getCurrentOfferVersion,
  listOfferVersions,
  updateAffiliateOffer,
  decideConversionApproval,
  setConversionApproval,
} from '../src/affiliate-offers.js';
import {
  getAttributionDecision,
} from '../src/affiliate-attribution.js';
import { trackConversion } from '../src/conversions.js';
import { asD1 } from './d1-test-helper.js';

/**
 * F-23 追補（2026-10-03 オーナー指示 O担当）。
 *
 * 公開案件の報酬変更をはさんだ成果の扱いを、実入口（trackConversion へ
 * 処理時刻を固定で渡す）で有限に再現する。合成DB（:memory: + bootstrap）
 * のみを使い、外部通信・実DB更新はしない。
 */

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
// 実入口が使う処理時刻。変更前と変更後で固定値を分ける。
const BEFORE_MS = Date.parse('2026-10-01T12:00:00+09:00');
const AFTER_MS = Date.parse('2026-10-03T12:00:00+09:00');

function jstString(ms: number): string {
  return new Date(ms + 9 * 60 * 60_000).toISOString().slice(0, -1) + '+09:00';
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('account-1', 'channel-1', '本店', 'token', 'secret', '${TENANT_ID}');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('friend-1', 'U1', 'はなこ', 'account-1'),
           ('friend-2', 'U2', 'けんた', 'account-1');
    INSERT INTO affiliates (id, name, code, commission_rate, friend_id, tenant_id, line_account_id, hold_days)
    VALUES ('aff-1', 'はなこ', 'hana', 0, NULL, '${TENANT_ID}', 'account-1', 0),
           ('aff-2', 'けんた', 'kenta', 0, NULL, '${TENANT_ID}', 'account-1', 0);
    INSERT INTO conversion_points (id, name, event_type, value, line_account_id)
    VALUES ('point-1', '購入', 'purchase', 10000, 'account-1');
    INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
    VALUES ('default', 'default', 'Harnessマイル', '2026-08-01', '2026-08-01');
    INSERT INTO affiliate_offers (id, name, reward_amount, reward_miles, line_account_id, created_at)
    VALUES ('offer-1', '定期便', 1000, 50, 'account-1', '2026-09-01T00:00:00.000+09:00');
    INSERT INTO affiliate_links (id, affiliate_id, ref_code, line_account_id, offer_id, created_at)
    VALUES ('link-1', 'aff-1', 'ref-1', 'account-1', 'offer-1', '2026-09-01T00:00:00.000+09:00'),
           ('link-2', 'aff-2', 'ref-2', 'account-1', 'offer-1', '2026-09-01T00:00:00.000+09:00');
  `);
  db = asD1(sqlite);
});

function insertTouch(id: string, refCode: string, friendId: string, atMs: number): void {
  sqlite.prepare(
    `INSERT INTO ref_tracking (id, ref_code, friend_id, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, refCode, friendId, jstString(atMs));
}

/**
 * 版の作成時刻を記録時刻より前へ寄せる。本番では版が成果より先に
 * 作られるため、その順序を再現する（createOfferVersion は実時刻で刻む）。
 */
function backdateVersion(versionId: string, atMs: number): void {
  sqlite.prepare(
    `UPDATE affiliate_offer_versions SET created_at = ? WHERE id = ?`,
  ).run(jstString(atMs), versionId);
}

/**
 * 有限barrier付きDB：resolveの最後の読み取りが返った直後、次の
 * 承認UPDATEが実行される前に、指定の割り込みを確実に差し込む。
 * better-sqlite3は同期的だがawait境界で順序が割れるため、proxyで
 * 「precheck→UPDATE→freeze」の別await境界そのものを再現する。
 */
function barrierDb(
  realDb: D1Database,
  shouldFire: (sql: string) => boolean,
  fire: () => Promise<unknown>,
): { db: D1Database; done: () => Promise<void> } {
  let fired: Promise<unknown> | null = null;
  const wrapStatement = (sql: string, stmt: Record<string, unknown>): Record<string, unknown> => ({
    bind: (...args: unknown[]) =>
      wrapStatement(sql, (stmt.bind as (...a: unknown[]) => Record<string, unknown>)(...args)),
    first: async (...args: unknown[]) => {
      const out = await (stmt.first as (...a: unknown[]) => Promise<unknown>)(...args);
      if (!fired && shouldFire(sql)) {
        // resolveの読み取りが返った直後に割り込みを開始する。
        fired = fire();
      }
      return out;
    },
    all: async (...args: unknown[]) =>
      (stmt.all as (...a: unknown[]) => Promise<unknown>)(...args),
    run: async (...args: unknown[]) => {
      // 承認UPDATEは割り込みの完了を待ってから実行する。
      if (fired && sql.includes('UPDATE conversion_events') && sql.includes('approval_status')) {
        await fired;
      }
      return (stmt.run as (...a: unknown[]) => Promise<unknown>)(...args);
    },
    raw: async (...args: unknown[]) =>
      (stmt.raw as (...a: unknown[]) => Promise<unknown>)(...args),
  });
  const db = {
    prepare: (sql: string) =>
      wrapStatement(sql, realDb.prepare(sql) as unknown as Record<string, unknown>),
    batch: (statements: D1PreparedStatement[]) =>
      (realDb.batch as (s: D1PreparedStatement[]) => Promise<unknown>)(statements),
  } as unknown as D1Database;
  return { db, done: async () => { await fired; } };
}

const calcOf = (eventId: string) => (
  sqlite.prepare(
    `SELECT fixed_reward_snapshot, amount_minor FROM affiliate_reward_calculations WHERE conversion_event_id = ?`,
  ).get(eventId) as { fixed_reward_snapshot: number; amount_minor: number }
);

describe('F-23 ケース3: 報酬変更前後の成果は記録時の版で凍結する', () => {
  test('変更前に記録した未承認成果は変更後に承認しても旧額、変更後の記録は新額', async () => {
    const v1 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    backdateVersion(v1.id, BEFORE_MS - 2 * 86_400_000);
    insertTouch('t1', 'ref-1', 'friend-1', BEFORE_MS - 86_400_000);
    const before = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c3-before' },
      { now: BEFORE_MS },
    );
    expect(before.approval_status).toBe('pending');

    // 報酬を 1000 → 2000 へ変更（PUT と同じ順序：版を先に作り、案件行を更新）。
    const v2 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 2000 });
    backdateVersion(v2.id, AFTER_MS - 3_600_000);
    await updateAffiliateOffer(db, 'offer-1', { reward_amount: 2000 });
    expect(v2.version_number).toBe(2);

    // 変更前の未承認成果を変更後に承認しても旧額。
    const approved = await decideConversionApproval(db, before.id, 'approved', 'pending');
    expect(approved.outcome).toBe('updated');
    expect(calcOf(before.id)).toMatchObject({ fixed_reward_snapshot: 1000, amount_minor: 1000 });
    const frozen = sqlite.prepare(
      `SELECT approval_fixed_reward, approval_amount_minor FROM conversion_events WHERE id = ?`,
    ).get(before.id) as { approval_fixed_reward: number; approval_amount_minor: number };
    expect(frozen).toMatchObject({ approval_fixed_reward: 1000, approval_amount_minor: 1000 });

    // 変更後に記録した成果は新額。
    insertTouch('t2', 'ref-2', 'friend-2', AFTER_MS - 86_400_000);
    const after = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-2', idempotencyKey: 'f23-c3-after' },
      { now: AFTER_MS },
    );
    const decisionAfter = await getAttributionDecision(db, after.id);
    expect(decisionAfter?.offer_version_id).toBe(v2.id);
    const approvedAfter = await decideConversionApproval(db, after.id, 'approved', 'pending');
    expect(approvedAfter.outcome).toBe('updated');
    expect(calcOf(after.id)).toMatchObject({ fixed_reward_snapshot: 2000, amount_minor: 2000 });

    // 変更前の成果の帰属版は v1 のまま。
    expect((await getAttributionDecision(db, before.id))?.offer_version_id).toBe(v1.id);
  });

  test('同一成果の再送は元の版を保つ', async () => {
    const rv1 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    backdateVersion(rv1.id, BEFORE_MS - 2 * 86_400_000);
    insertTouch('t1', 'ref-1', 'friend-1', BEFORE_MS - 86_400_000);
    const first = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c3-resend' },
      { now: BEFORE_MS },
    );
    const firstVersion = (await getAttributionDecision(db, first.id))?.offer_version_id;

    const rv2 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 2000 });
    backdateVersion(rv2.id, AFTER_MS - 3_600_000);
    await updateAffiliateOffer(db, 'offer-1', { reward_amount: 2000 });

    const resent = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c3-resend' },
      { now: AFTER_MS },
    );
    expect(resent.id).toBe(first.id);
    expect((await getAttributionDecision(db, first.id))?.offer_version_id).toBe(firstVersion);
  });
});

describe('F-23 ケース4: 保存途中失敗の有限境界を正確に報告する', () => {
  test('版保存後・案件本体更新前の失敗：版は新額、案件行は旧額、承認は版に従う', async () => {
    await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    // 版の保存だけ通って案件行の更新に失敗した状態。
    const v2 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 2000 });

    expect(await getCurrentOfferVersion(db, 'offer-1')).toMatchObject({
      id: v2.id,
      reward_amount: 2000,
    });
    expect((await getAffiliateOfferById(db, 'offer-1'))?.reward_amount).toBe(1000);

    // この状態で記録した成果は新しい版（v2）に付く。旧版を新額へ
    // 書き換えることはしない（v1 は 1000 のまま）。
    insertTouch('t1', 'ref-1', 'friend-1', AFTER_MS - 86_400_000);
    const event = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c4-partial' },
      { now: AFTER_MS },
    );
    expect((await getAttributionDecision(db, event.id))?.offer_version_id).toBe(v2.id);
    const versions = await listOfferVersions(db, 'offer-1');
    expect(versions.find((v) => v.version_number === 1)).toMatchObject({ reward_amount: 1000 });

    const approved = await decideConversionApproval(db, event.id, 'approved', 'pending');
    expect(approved.outcome).toBe('updated');
    expect(calcOf(event.id)).toMatchObject({ fixed_reward_snapshot: 2000, amount_minor: 2000 });
  });

  test('版番号は最大値の次を取り、(案件, 版番号)の二重登録はUNIQUEで止まる', async () => {
    const first = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    // 交差した書き込み手が版番号2を先に取った状態を直接作る。
    sqlite.prepare(
      `INSERT INTO affiliate_offer_versions (id, offer_id, version_number) VALUES ('rival-v2', 'offer-1', 2)`,
    ).run();
    const next = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 2000 });
    expect(next.version_number).toBe(3);

    // 同じ (案件, 版番号) の直書きは通らない（負けた書き込みは残らず失敗する）。
    expect(() =>
      sqlite.prepare(
        `INSERT INTO affiliate_offer_versions (id, offer_id, version_number) VALUES ('dup-v3', 'offer-1', 3)`,
      ).run(),
    ).toThrow(/UNIQUE constraint failed/i);

    // 先勝ちの版も旧版も書き換わらない。
    const versions = await listOfferVersions(db, 'offer-1');
    expect(versions.map((v) => [v.version_number, v.reward_amount])).toEqual([
      [3, 2000],
      [2, 0],
      [1, 1000],
    ]);
    expect(versions.find((v) => v.version_number === 1)?.id).toBe(first.id);
  });
});

describe('F-23 ケース5: 承認の境界（所有・再試行）を保つ', () => {
  test('期待状態が違う判断はconflictになり上書きしない', async () => {
    await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    insertTouch('t1', 'ref-1', 'friend-1', BEFORE_MS - 86_400_000);
    const event = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c5-cas' },
      { now: BEFORE_MS },
    );
    const first = await decideConversionApproval(db, event.id, 'approved', 'pending');
    expect(first.outcome).toBe('updated');
    // 承認済みを未判断として却下しようとしても通らない。
    const conflict = await decideConversionApproval(db, event.id, 'rejected', 'pending');
    expect(conflict).toMatchObject({ outcome: 'conflict', currentStatus: 'approved' });
    expect(calcOf(event.id)).toMatchObject({ amount_minor: 1000 });
  });

  test('同じ判断の再送はalready_setで冪等にし、版の欠落だけ修復する', async () => {
    await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    insertTouch('t1', 'ref-1', 'friend-1', BEFORE_MS - 86_400_000);
    const event = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c5-retry' },
      { now: BEFORE_MS },
    );
    expect(await decideConversionApproval(db, event.id, 'approved', 'pending')).toMatchObject({
      outcome: 'updated',
    });
    const again = await decideConversionApproval(db, event.id, 'approved', 'approved');
    expect(again).toMatchObject({ outcome: 'already_set', currentStatus: 'approved' });
    const calcs = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM affiliate_reward_calculations WHERE conversion_event_id = ?`,
    ).get(event.id) as { n: number };
    expect(calcs.n).toBe(1);
    expect(calcOf(event.id)).toMatchObject({ amount_minor: 1000 });
  });

  test('帰属のない成果の承認は通らない', async () => {
    await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    const event = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-2', idempotencyKey: 'f23-c5-noattr' },
      { now: BEFORE_MS },
    );
    expect(event.affiliate_id).toBeNull();
    expect(await setConversionApproval(db, event.id, 'approved')).toBe(false);
  });
});

describe('F-23 ケース6: 帰属版の保存失敗→再送→報酬編集→承認は旧額を保つ', () => {
  test('判断記録がなくても記録時刻の版で旧額が決まる（現在額2000では固まらない）', async () => {
    const v1 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    backdateVersion(v1.id, BEFORE_MS - 2 * 86_400_000);
    insertTouch('t1', 'ref-1', 'friend-1', BEFORE_MS - 86_400_000);
    const event = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c6-missing' },
      { now: BEFORE_MS },
    );
    expect((await getAttributionDecision(db, event.id))?.offer_version_id).toBe(v1.id);

    // 判断の保存だけ落ちた状態（成果は残り、判断だけ無い）を再現する。
    sqlite.prepare(`DELETE FROM affiliate_attribution_decisions WHERE conversion_event_id = ?`).run(event.id);
    expect(await getAttributionDecision(db, event.id)).toBeNull();

    // 同成果の再送では判断は戻らない（再送は既存成果を返すだけ）。
    const resent = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c6-missing' },
      { now: BEFORE_MS },
    );
    expect(resent.id).toBe(event.id);
    expect(await getAttributionDecision(db, event.id)).toBeNull();

    // 報酬編集のあと承認する。
    await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 2000 });
    await updateAffiliateOffer(db, 'offer-1', { reward_amount: 2000 });
    const approved = await decideConversionApproval(db, event.id, 'approved', 'pending');
    expect(approved.outcome).toBe('updated');

    // 判断が無くても記録時刻（変更前）の版 v1 で旧額 1000 が決まる。
    expect(calcOf(event.id)).toMatchObject({ fixed_reward_snapshot: 1000, amount_minor: 1000 });
    const frozen = sqlite.prepare(
      `SELECT approval_fixed_reward, approval_amount_minor FROM conversion_events WHERE id = ?`,
    ).get(event.id) as { approval_fixed_reward: number; approval_amount_minor: number };
    expect(frozen).toMatchObject({ approval_fixed_reward: 1000, approval_amount_minor: 1000 });
  });

  test('当時版が未確定（版管理下なのに記録時刻の版が無い）なら承認しない', async () => {
    // 成果より後にしか版が無い状態を直接作る（欠落・改ざんの再現）。
    sqlite.prepare(
      `INSERT INTO conversion_events
         (id, conversion_point_id, friend_id, created_at, affiliate_id,
          attributed_ref_code, approval_status, point_name_snapshot, event_type_snapshot, tenant_id)
       VALUES ('evt-undetermined', 'point-1', 'friend-1',
          '2026-09-01T12:00:00.000+09:00', 'aff-1', 'ref-1', 'pending',
          '購入', 'purchase', '${TENANT_ID}')`,
    ).run();
    // 版は成果より後（2026-10-01）にしか無い。
    sqlite.prepare(
      `INSERT INTO affiliate_offer_versions
         (id, offer_id, version_number, reward_amount, reward_miles, window_days, created_at)
       VALUES ('ver-late-1', 'offer-1', 1, 2000, 0, 30, '2026-10-01T12:00:00.000+09:00')`,
    ).run();

    const refused = await decideConversionApproval(db, 'evt-undetermined', 'approved', 'pending');
    expect(refused).toMatchObject({ outcome: 'unbillable', currentStatus: 'pending' });

    // 状態は変わらず、版も凍結も残らない。
    const status = sqlite.prepare(
      `SELECT approval_status FROM conversion_events WHERE id = 'evt-undetermined'`,
    ).get() as { approval_status: string };
    expect(status.approval_status).toBe('pending');
    const calcs = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM affiliate_reward_calculations WHERE conversion_event_id = 'evt-undetermined'`,
    ).get() as { n: number };
    expect(calcs.n).toBe(0);
    const frozen = sqlite.prepare(
      `SELECT approval_fixed_reward FROM conversion_events WHERE id = 'evt-undetermined'`,
    ).get() as { approval_fixed_reward: number | null };
    expect(frozen.approval_fixed_reward).toBeNull();

    // 却下は金額を固めないので従来どおり通す。
    const rejected = await decideConversionApproval(db, 'evt-undetermined', 'rejected', 'pending');
    expect(rejected).toMatchObject({ outcome: 'updated', currentStatus: 'rejected' });
  });

  test('同じmsで新版が並んだら旧額と断定せず承認しない（独立SOURCE監査の有限順序）', async () => {
    // 有限順序：成果の処理now採取→v1判断→判断保存失敗→同じmsでv2保存→後の承認。
    // 実入口（trackConversionへ処理時刻を固定）と既存関数（createOfferVersion）で再現する。
    const v1 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    backdateVersion(v1.id, BEFORE_MS - 2 * 86_400_000);
    insertTouch('t1', 'ref-1', 'friend-1', BEFORE_MS - 86_400_000);
    const event = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c6-samems' },
      { now: BEFORE_MS },
    );
    expect((await getAttributionDecision(db, event.id))?.offer_version_id).toBe(v1.id);
    const recordedAt = (sqlite.prepare(
      `SELECT created_at FROM conversion_events WHERE id = ?`,
    ).get(event.id) as { created_at: string }).created_at;

    // 判断の保存だけ落ちた状態にする。
    sqlite.prepare(`DELETE FROM affiliate_attribution_decisions WHERE conversion_event_id = ?`).run(event.id);

    // 同じmsで新版が保存される（作成時刻を記録時刻と完全一致させる）。
    const v2 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 2000 });
    sqlite.prepare(`UPDATE affiliate_offer_versions SET created_at = ? WHERE id = ?`).run(recordedAt, v2.id);
    await updateAffiliateOffer(db, 'offer-1', { reward_amount: 2000 });

    // v2（新額2000）で固まってはならない。当時版は確定不能のため承認しない。
    const decided = await decideConversionApproval(db, event.id, 'approved', 'pending');
    expect(decided).toMatchObject({ outcome: 'unbillable', currentStatus: 'pending' });
    const status = sqlite.prepare(
      `SELECT approval_status, approval_fixed_reward FROM conversion_events WHERE id = ?`,
    ).get(event.id) as { approval_status: string; approval_fixed_reward: number | null };
    expect(status.approval_status).toBe('pending');
    expect(status.approval_fixed_reward).toBeNull();
    const calcs = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM affiliate_reward_calculations WHERE conversion_event_id = ?`,
    ).get(event.id) as { n: number };
    expect(calcs.n).toBe(0);
  });

  test('同時刻の版が1件だけならその版で旧額が決まる（過剰な拒否をしない）', async () => {
    const v1 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    insertTouch('t1', 'ref-1', 'friend-1', BEFORE_MS - 86_400_000);
    const event = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c6-samems-single' },
      { now: BEFORE_MS },
    );
    const recordedAt = (sqlite.prepare(
      `SELECT created_at FROM conversion_events WHERE id = ?`,
    ).get(event.id) as { created_at: string }).created_at;
    // 判断を落とし、唯一の版の作成時刻を記録時刻と一致させる。
    sqlite.prepare(`DELETE FROM affiliate_attribution_decisions WHERE conversion_event_id = ?`).run(event.id);
    sqlite.prepare(`UPDATE affiliate_offer_versions SET created_at = ? WHERE id = ?`).run(recordedAt, v1.id);

    // 報酬編集のあと承認する（新版は記録時刻より後）。
    await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 2000 });
    await updateAffiliateOffer(db, 'offer-1', { reward_amount: 2000 });
    const decided = await decideConversionApproval(db, event.id, 'approved', 'pending');
    expect(decided.outcome).toBe('updated');
    expect(calcOf(event.id)).toMatchObject({ fixed_reward_snapshot: 1000, amount_minor: 1000 });
  });

  test('setConversionApproval でも当時版未確定の承認は通さない', async () => {
    sqlite.prepare(
      `INSERT INTO conversion_events
         (id, conversion_point_id, friend_id, created_at, affiliate_id,
          attributed_ref_code, approval_status, point_name_snapshot, event_type_snapshot, tenant_id)
       VALUES ('evt-undetermined-2', 'point-1', 'friend-1',
          '2026-09-01T12:00:00.000+09:00', 'aff-1', 'ref-1', 'pending',
          '購入', 'purchase', '${TENANT_ID}')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO affiliate_offer_versions
         (id, offer_id, version_number, reward_amount, reward_miles, window_days, created_at)
       VALUES ('ver-late-2', 'offer-1', 1, 2000, 0, 30, '2026-10-01T12:00:00.000+09:00')`,
    ).run();
    expect(await setConversionApproval(db, 'evt-undetermined-2', 'approved')).toBe(false);
    const status = sqlite.prepare(
      `SELECT approval_status FROM conversion_events WHERE id = 'evt-undetermined-2'`,
    ).get() as { approval_status: string };
    expect(status.approval_status).toBe('pending');
  });
});

describe('F-23 交差：precheck後のPOST回収で初版が生えても承認と凍結は同じ根拠を使う', () => {
  test('有限barrier：resolve確定→POST同キー回収→承認UPDATE→凍結で旧額1000が一貫する', async () => {
    // 案件行だけ通って初版保存に失敗した公開案件（POST回収前の姿）。
    const offer = await createAffiliateOffer(db, {
      name: '版なし公開案件',
      rewardAmount: 1000,
      lineAccountId: 'account-1',
    });
    expect(await getCurrentOfferVersion(db, offer.id)).toBeNull();
    sqlite.prepare(
      `INSERT INTO affiliate_links (id, affiliate_id, ref_code, line_account_id, offer_id, created_at)
       VALUES ('link-race', 'aff-1', 'ref-race', 'account-1', ?, '2026-09-01T00:00:00.000+09:00')`,
    ).run(offer.id);
    insertTouch('t-race', 'ref-race', 'friend-1', BEFORE_MS - 86_400_000);
    const event = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c6-race' },
      { now: BEFORE_MS },
    );
    expect(event.affiliate_id).toBe('aff-1');

    // precheckのresolveが版0を確認して返った直後、承認UPDATEの前に
    // POST同キー再送の回収（初版2000）が割り込む。金額を変えてあるのは
    // どの根拠（precheck時の現在額1000／生えた初版2000／未確定）が
    // 使われたかを見分けるためで、仕様の追加ではない。
    const { db: bdb, done } = barrierDb(
      db,
      (sql) => sql.includes('COUNT(*)') && sql.includes('FROM affiliate_offer_versions'),
      () => createOfferVersion(db, { offerId: offer.id, rewardAmount: 2000 }),
    );
    const decided = await decideConversionApproval(bdb, event.id, 'approved', 'pending');
    await done();
    expect(decided.outcome).toBe('updated');

    // 回収で生えた初版は2000だが、承認判断時の根拠（現在額1000）が
    // 凍結と計算の両方に一貫して使われる。
    const v1 = await getCurrentOfferVersion(db, offer.id);
    expect(v1).toMatchObject({ version_number: 1, reward_amount: 2000 });
    expect(calcOf(event.id)).toMatchObject({ fixed_reward_snapshot: 1000, amount_minor: 1000 });
    const frozen = sqlite.prepare(
      `SELECT approval_fixed_reward, approval_amount_minor FROM conversion_events WHERE id = ?`,
    ).get(event.id) as { approval_fixed_reward: number; approval_amount_minor: number };
    expect(frozen).toMatchObject({ approval_fixed_reward: 1000, approval_amount_minor: 1000 });

    // 判断記録の事後補填はしない（付け方詳細の欠落は残る。金額は正しい）。
    expect((await getAttributionDecision(db, event.id))?.offer_version_id).toBeNull();
  });
});
