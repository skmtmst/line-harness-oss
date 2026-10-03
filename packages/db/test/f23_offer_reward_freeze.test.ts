import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
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

const calcOf = (eventId: string) => (
  sqlite.prepare(
    `SELECT fixed_reward_snapshot, amount_minor FROM affiliate_reward_calculations WHERE conversion_event_id = ?`,
  ).get(eventId) as { fixed_reward_snapshot: number; amount_minor: number }
);

describe('F-23 ケース3: 報酬変更前後の成果は記録時の版で凍結する', () => {
  test('変更前に記録した未承認成果は変更後に承認しても旧額、変更後の記録は新額', async () => {
    const v1 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    insertTouch('t1', 'ref-1', 'friend-1', BEFORE_MS - 86_400_000);
    const before = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c3-before' },
      { now: BEFORE_MS },
    );
    expect(before.approval_status).toBe('pending');

    // 報酬を 1000 → 2000 へ変更（PUT と同じ順序：版を先に作り、案件行を更新）。
    const v2 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 2000 });
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
    await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    insertTouch('t1', 'ref-1', 'friend-1', BEFORE_MS - 86_400_000);
    const first = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'f23-c3-resend' },
      { now: BEFORE_MS },
    );
    const firstVersion = (await getAttributionDecision(db, first.id))?.offer_version_id;

    await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 2000 });
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
    await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    // 交差した書き込み手が版番号2を先に取った状態を直接作る。
    sqlite.prepare(
      `INSERT INTO affiliate_offer_versions (id, offer_id, version_number) VALUES ('rival-v2', 'offer-1', 2)`,
    ).run();
    const next = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 2000 });
    expect(next.version_number).toBe(3);

    // 同じ (案件, 版番号) の直書きは通らない。
    expect(() =>
      sqlite.prepare(
        `INSERT INTO affiliate_offer_versions (id, offer_id, version_number) VALUES ('dup-v3', 'offer-1', 3)`,
      ).run(),
    ).toThrow(/UNIQUE constraint failed/i);
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

describe('F-23 ケース6: 帰属版の保存失敗→再送→報酬編集→承認は現在額fallback', () => {
  test('判断記録がない成果の承認は、編集後の現在額で版を作る', async () => {
    const v1 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
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

    // 判断が無いため当時額は分からず、現在額（2000）で版ができる。
    expect(calcOf(event.id)).toMatchObject({ fixed_reward_snapshot: 2000, amount_minor: 2000 });
    const frozen = sqlite.prepare(
      `SELECT approval_fixed_reward FROM conversion_events WHERE id = ?`,
    ).get(event.id) as { approval_fixed_reward: number };
    expect(frozen.approval_fixed_reward).toBe(2000);
  });
});
