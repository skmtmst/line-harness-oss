import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  createOfferVersion,
  getCurrentOfferVersion,
  getOfferCapStatus,
  listOfferVersions,
  OFFER_ATTRIBUTION_WINDOW_DEFAULT,
} from '../src/affiliate-offers.js';
import {
  explainAffiliateAttribution,
  getAttributionDecision,
  recordAttributionDecision,
} from '../src/affiliate-attribution.js';
import { decideConversionApproval } from '../src/affiliate-offers.js';
import { ensureConversionRewardSnapshot } from '../src/affiliate-settlements.js';
import { trackConversion } from '../src/conversions.js';
import { asD1 } from './d1-test-helper.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
// 固定の「いま」。trackConversion へ runtime で渡して決定的にする。
const NOW_MS = Date.parse('2026-09-27T12:00:00+09:00');
const NOW = '2026-09-27T12:00:00.000+09:00';

function jstDaysAgo(days: number): string {
  const ms = NOW_MS - days * 86_400_000;
  const jst = new Date(ms + 9 * 60 * 60_000);
  return jst.toISOString().slice(0, -1) + '+09:00';
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES ('account-1', 'channel-1', '本店', 'token', 'secret', '${TENANT_ID}'),
           ('account-2', 'channel-2', '支店', 'token', 'secret', '${TENANT_ID}');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('friend-1', 'U1', 'はなこ', 'account-1'),
           ('friend-2', 'U2', 'けんた', 'account-1'),
           ('friend-self', 'U3', '本人', 'account-1');
    INSERT INTO affiliates (id, name, code, commission_rate, friend_id, tenant_id, line_account_id, hold_days)
    VALUES ('aff-1', 'はなこ', 'hana', 0, NULL, '${TENANT_ID}', 'account-1', 0),
           ('aff-2', 'けんた', 'kenta', 0, NULL, '${TENANT_ID}', 'account-1', 0),
           ('aff-self', '本人', 'self', 0, 'friend-self', '${TENANT_ID}', 'account-1', 0),
           ('aff-other', '別アカ', 'other', 0, NULL, '${TENANT_ID}', 'account-2', 0);
    INSERT INTO conversion_points (id, name, event_type, value, line_account_id)
    VALUES ('point-1', '購入', 'purchase', 10000, 'account-1');
    INSERT INTO mileage_programs (id, code, name, created_at, updated_at)
    VALUES ('default', 'default', 'Harnessマイル', '2026-08-01', '2026-08-01');
    INSERT INTO affiliate_offers (id, name, reward_amount, reward_miles, line_account_id, created_at)
    VALUES ('offer-1', '定期便', 1000, 50, 'account-1', '2026-09-01T00:00:00.000+09:00');
    INSERT INTO affiliate_links (id, affiliate_id, ref_code, line_account_id, offer_id, created_at)
    VALUES ('link-1', 'aff-1', 'ref-1', 'account-1', 'offer-1', '2026-09-01T00:00:00.000+09:00'),
           ('link-2', 'aff-2', 'ref-2', 'account-1', 'offer-1', '2026-09-01T00:00:00.000+09:00'),
           ('link-self', 'aff-self', 'ref-self', 'account-1', 'offer-1', '2026-09-01T00:00:00.000+09:00'),
           ('link-other', 'aff-other', 'ref-other', 'account-2', 'offer-1', '2026-09-01T00:00:00.000+09:00'),
           ('link-generic', 'aff-1', 'ref-generic', 'account-1', NULL, '2026-09-01T00:00:00.000+09:00');
  `);
  db = asD1(sqlite);
});

function insertTouch(id: string, refCode: string, friendId: string, createdAt: string): void {
  sqlite.prepare(
    `INSERT INTO ref_tracking (id, ref_code, friend_id, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, refCode, friendId, createdAt);
}

describe('472 案件の決まりの版', () => {
  test('数える期間の既定は30日', () => {
    expect(OFFER_ATTRIBUTION_WINDOW_DEFAULT).toBe(30);
  });

  test('初版は案件の今の値・期間30日・上限なしで生まれる', async () => {
    const v1 = await createOfferVersion(db, { offerId: 'offer-1' });
    expect(v1).toMatchObject({
      version_number: 1,
      reward_amount: 1000,
      reward_miles: 50,
      window_days: 30,
      cap_total: null,
      cap_monthly_per_affiliate: null,
      reception_from: null,
      reception_to: null,
    });
    expect(await getCurrentOfferVersion(db, 'offer-1')).toMatchObject({ id: v1.id });
  });

  test('保存するたびに版が増え、前の版は変わらない', async () => {
    const v1 = await createOfferVersion(db, { offerId: 'offer-1' });
    const v2 = await createOfferVersion(db, {
      offerId: 'offer-1',
      rewardAmount: 2000,
      windowDays: 14,
      capTotal: 200,
      capMonthlyPerAffiliate: 10,
      receptionFrom: '2026-10-01T00:00:00.000+09:00',
      receptionTo: '2026-12-31T23:59:59.000+09:00',
    });
    expect(v2.version_number).toBe(2);
    // 指定しなかった報酬マイルは前の版を引き継ぐ。
    expect(v2.reward_miles).toBe(50);
    const versions = await listOfferVersions(db, 'offer-1');
    expect(versions.map((v) => v.version_number)).toEqual([2, 1]);
    expect(versions.find((v) => v.version_number === 1)).toMatchObject({
      id: v1.id,
      reward_amount: 1000,
      window_days: 30,
    });
  });

  test('期間・上限の壊れた値は版を作らない', async () => {
    await expect(createOfferVersion(db, { offerId: 'offer-1', windowDays: 0 }))
      .rejects.toThrow('windowDays');
    await expect(createOfferVersion(db, { offerId: 'offer-1', windowDays: 366 }))
      .rejects.toThrow('windowDays');
    await expect(createOfferVersion(db, { offerId: 'offer-1', capTotal: 0 }))
      .rejects.toThrow('cap');
    await expect(createOfferVersion(db, { offerId: 'offer-1', capMonthlyPerAffiliate: -1 }))
      .rejects.toThrow('cap');
    expect(await listOfferVersions(db, 'offer-1')).toEqual([]);
  });

  test('同じ確認キーの再送では版を増やさない', async () => {
    const first = await createOfferVersion(db, {
      offerId: 'offer-1',
      rewardAmount: 2000,
      idempotencyKey: 'op-1',
    });
    const second = await createOfferVersion(db, {
      offerId: 'offer-1',
      rewardAmount: 9999,
      idempotencyKey: 'op-1',
    });
    expect(second.id).toBe(first.id);
    expect(await listOfferVersions(db, 'offer-1')).toHaveLength(1);
  });

  test('無い案件の版は作れない', async () => {
    await expect(createOfferVersion(db, { offerId: 'offer-missing' }))
      .rejects.toThrow('offer not found');
  });
});

describe('472 上限の使用状況', () => {
  test('上限なしは止まらない', async () => {
    await createOfferVersion(db, { offerId: 'offer-1' });
    const status = await getOfferCapStatus(db, 'offer-1', { affiliateId: 'aff-1', at: NOW });
    expect(status).toMatchObject({
      capped: false,
      capTotal: null,
      totalRemaining: null,
      capMonthlyPerAffiliate: null,
      monthlyRemaining: null,
    });
  });

  test('案件全体の上限に達したら止まる', async () => {
    await createOfferVersion(db, { offerId: 'offer-1', capTotal: 2 });
    insertTouch('t1', 'ref-1', 'friend-1', jstDaysAgo(1));
    insertTouch('t2', 'ref-2', 'friend-2', jstDaysAgo(1));
    await trackConversion(db, { conversionPointId: 'point-1', friendId: 'friend-1' }, { now: NOW_MS });
    const before = await getOfferCapStatus(db, 'offer-1', { at: NOW });
    expect(before).toMatchObject({ capped: false, totalUsed: 1, totalRemaining: 1 });
    await trackConversion(db, { conversionPointId: 'point-1', friendId: 'friend-2' }, { now: NOW_MS });
    const after = await getOfferCapStatus(db, 'offer-1', { at: NOW });
    expect(after).toMatchObject({ capped: true, totalUsed: 2, totalRemaining: 0 });
  });

  test('1人あたり月の上限は人ごとに数える', async () => {
    await createOfferVersion(db, { offerId: 'offer-1', capMonthlyPerAffiliate: 1 });
    insertTouch('t1', 'ref-1', 'friend-1', jstDaysAgo(1));
    await trackConversion(db, { conversionPointId: 'point-1', friendId: 'friend-1' }, { now: NOW_MS });
    const full = await getOfferCapStatus(db, 'offer-1', { affiliateId: 'aff-1', at: NOW });
    expect(full).toMatchObject({ capped: true, monthlyUsed: 1, monthlyRemaining: 0 });
    // 別の紹介者はまだ付けられる。
    const other = await getOfferCapStatus(db, 'offer-1', { affiliateId: 'aff-2', at: NOW });
    expect(other).toMatchObject({ capped: false, monthlyUsed: 0, monthlyRemaining: 1 });
  });
});

describe('473 成果の付け方の判断', () => {
  test('期間内の紹介のうち、最後に開いたリンクに付ける', async () => {
    await createOfferVersion(db, { offerId: 'offer-1' });
    insertTouch('t1', 'ref-1', 'friend-1', jstDaysAgo(5));
    insertTouch('t2', 'ref-2', 'friend-1', jstDaysAgo(1));
    const explanation = await explainAffiliateAttribution(db, 'friend-1', NOW, {
      lineAccountId: 'account-1',
    });
    expect(explanation.reason).toBe('matched_last_touch');
    expect(explanation.decision).toMatchObject({ affiliateId: 'aff-2', refCode: 'ref-2' });
    expect(explanation.candidates).toHaveLength(1);
  });

  test('自分の紹介には付けず、理由を残す', async () => {
    await createOfferVersion(db, { offerId: 'offer-1' });
    insertTouch('t1', 'ref-self', 'friend-self', jstDaysAgo(1));
    const explanation = await explainAffiliateAttribution(db, 'friend-self', NOW, {
      lineAccountId: 'account-1',
    });
    expect(explanation.decision).toBeNull();
    expect(explanation.reason).toBe('self_referral');
    expect(explanation.candidates).toMatchObject([{ chosen: false, skipReason: 'self_referral' }]);
  });

  test('案件の期間(30日)を過ぎた紹介には付けない。汎用リンクは90日のまま', async () => {
    await createOfferVersion(db, { offerId: 'offer-1' });
    insertTouch('t1', 'ref-1', 'friend-1', jstDaysAgo(40));
    const offerCase = await explainAffiliateAttribution(db, 'friend-1', NOW, {
      lineAccountId: 'account-1',
    });
    expect(offerCase.decision).toBeNull();
    expect(offerCase.reason).toBe('out_of_window');
    expect(offerCase.windowDays).toBe(30);

    insertTouch('t2', 'ref-generic', 'friend-2', jstDaysAgo(40));
    const genericCase = await explainAffiliateAttribution(db, 'friend-2', NOW, {
      lineAccountId: 'account-1',
    });
    expect(genericCase.reason).toBe('matched_last_touch');
    expect(genericCase.decision).toMatchObject({ affiliateId: 'aff-1', refCode: 'ref-generic' });
    expect(genericCase.windowDays).toBe(90);
  });

  test('紹介が無ければ付けない', async () => {
    const explanation = await explainAffiliateAttribution(db, 'friend-1', NOW, {
      lineAccountId: 'account-1',
    });
    expect(explanation.decision).toBeNull();
    expect(explanation.reason).toBe('no_touch');
    expect(explanation.candidates).toEqual([]);
  });

  test('別アカウントの紹介者は候補にしない', async () => {
    await createOfferVersion(db, { offerId: 'offer-1' });
    insertTouch('t1', 'ref-other', 'friend-1', jstDaysAgo(1));
    const explanation = await explainAffiliateAttribution(db, 'friend-1', NOW, {
      lineAccountId: 'account-1',
    });
    expect(explanation.decision).toBeNull();
    expect(explanation.reason).toBe('other_account');
  });

  test('受付の期間外は付けない', async () => {
    await createOfferVersion(db, {
      offerId: 'offer-1',
      receptionFrom: '2026-10-01T00:00:00.000+09:00',
      receptionTo: '2026-12-31T23:59:59.000+09:00',
    });
    insertTouch('t1', 'ref-1', 'friend-1', jstDaysAgo(1));
    const explanation = await explainAffiliateAttribution(db, 'friend-1', NOW, {
      lineAccountId: 'account-1',
    });
    expect(explanation.decision).toBeNull();
    expect(explanation.reason).toBe('reception_closed');
  });

  test('上限に達した案件には付けない', async () => {
    await createOfferVersion(db, { offerId: 'offer-1', capTotal: 1 });
    insertTouch('t1', 'ref-1', 'friend-1', jstDaysAgo(2));
    await trackConversion(db, { conversionPointId: 'point-1', friendId: 'friend-1' }, { now: NOW_MS });
    insertTouch('t2', 'ref-2', 'friend-2', jstDaysAgo(1));
    const explanation = await explainAffiliateAttribution(db, 'friend-2', NOW, {
      lineAccountId: 'account-1',
    });
    expect(explanation.decision).toBeNull();
    expect(explanation.reason).toBe('capped_total');
  });

  test('止めたリンク・止めた紹介者には付けない', async () => {
    await createOfferVersion(db, { offerId: 'offer-1' });
    sqlite.prepare(`UPDATE affiliate_links SET is_active = 0 WHERE id = 'link-1'`).run();
    sqlite.prepare(`UPDATE affiliates SET is_active = 0 WHERE id = 'aff-2'`).run();
    insertTouch('t1', 'ref-1', 'friend-1', jstDaysAgo(1));
    const linkCase = await explainAffiliateAttribution(db, 'friend-1', NOW, {
      lineAccountId: 'account-1',
    });
    expect(linkCase.reason).toBe('inactive_link');
    insertTouch('t2', 'ref-2', 'friend-2', jstDaysAgo(1));
    const affCase = await explainAffiliateAttribution(db, 'friend-2', NOW, {
      lineAccountId: 'account-1',
    });
    expect(affCase.reason).toBe('inactive_affiliate');
  });
});

describe('473 付け方の記録', () => {
  test('成果の取り込みで判断が残り、付けた先・理由・版が分かる', async () => {
    const v1 = await createOfferVersion(db, { offerId: 'offer-1' });
    insertTouch('t1', 'ref-1', 'friend-1', jstDaysAgo(1));
    const event = await trackConversion(
      db, { conversionPointId: 'point-1', friendId: 'friend-1' }, { now: NOW_MS },
    );
    expect(event.affiliate_id).toBe('aff-1');
    const decision = await getAttributionDecision(db, event.id);
    expect(decision).toMatchObject({
      conversion_event_id: event.id,
      affiliate_id: 'aff-1',
      ref_code: 'ref-1',
      offer_id: 'offer-1',
      offer_version_id: v1.id,
      reason: 'matched_last_touch',
      window_days: 30,
    });
  });

  test('同じ成果に2人分は付かない。再送は最初の記録を保つ', async () => {
    await createOfferVersion(db, { offerId: 'offer-1' });
    insertTouch('t1', 'ref-1', 'friend-1', jstDaysAgo(1));
    const first = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'key-1' },
      { now: NOW_MS },
    );
    const deduped = await trackConversion(
      db,
      { conversionPointId: 'point-1', friendId: 'friend-1', idempotencyKey: 'key-1' },
      { now: NOW_MS },
    );
    expect(deduped.id).toBe(first.id);
    const rows = sqlite.prepare(
      `SELECT * FROM affiliate_attribution_decisions WHERE conversion_event_id = ?`,
    ).all(first.id);
    expect(rows).toHaveLength(1);
  });

  test('付けなかった成果にも理由が残る', async () => {
    await createOfferVersion(db, { offerId: 'offer-1' });
    const event = await trackConversion(
      db, { conversionPointId: 'point-1', friendId: 'friend-2' }, { now: NOW_MS },
    );
    expect(event.affiliate_id).toBeNull();
    const decision = await getAttributionDecision(db, event.id);
    expect(decision).toMatchObject({ reason: 'no_touch', affiliate_id: null });
  });

  test('版を変えても、付けた時点の版で報酬が決まる', async () => {
    const v1 = await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 1000 });
    insertTouch('t1', 'ref-1', 'friend-1', jstDaysAgo(1));
    const event = await trackConversion(
      db, { conversionPointId: 'point-1', friendId: 'friend-1' }, { now: NOW_MS },
    );
    // 承認前に版を変える。過去の成果の報酬は動かない。
    await createOfferVersion(db, { offerId: 'offer-1', rewardAmount: 9999 });
    const result = await decideConversionApproval(db, event.id, 'approved', 'pending');
    expect(result.outcome).toBe('updated');
    const calc = sqlite.prepare(
      `SELECT * FROM affiliate_reward_calculations WHERE conversion_event_id = ?`,
    ).get(event.id) as Record<string, unknown>;
    expect(calc).toMatchObject({ fixed_reward_snapshot: 1000, amount_minor: 1000 });
    const decision = await getAttributionDecision(db, event.id);
    expect(decision?.offer_version_id).toBe(v1.id);
  });

  test('recordAttributionDecision の再送は最初の記録を保つ', async () => {
    await createOfferVersion(db, { offerId: 'offer-1' });
    insertTouch('t1', 'ref-1', 'friend-1', jstDaysAgo(1));
    const event = await trackConversion(
      db, { conversionPointId: 'point-1', friendId: 'friend-1' }, { now: NOW_MS },
    );
    const explanation = await explainAffiliateAttribution(db, 'friend-1', NOW, {
      lineAccountId: 'account-1',
    });
    await recordAttributionDecision(db, event.id, 'friend-1', 'point-1', explanation);
    await recordAttributionDecision(db, event.id, 'friend-1', 'point-1', {
      ...explanation,
      reason: 'no_touch',
      decision: null,
    });
    const decision = await getAttributionDecision(db, event.id);
    expect(decision?.reason).toBe('matched_last_touch');
  });
});
