import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { enqueueBirthdayCoupons, type NenCouponIssueFailure } from './nen-engagement.js';

/**
 * #934 N-298: 誕生日クーポンのEC作成失敗が他の子や通常配信を止めないこと。
 *  - 1匹のEC失敗で残りの子は発行・予約される（部分成功を全体失敗にしない）
 *  - 失敗した子の発行行は残らず、次の日次走査で同じコードへ収束する（孤児を残さない）
 *  - ECの重複（409）は成功と同じ意味で受け取る
 *  - 月日だけ（MM-DD）の誕生日も発行対象になる
 */

const SECRET = 'test-secret-test-secret-test-sec';
const EC = { baseUrl: 'https://ec.example', secret: SECRET };

// 届ける日（JST）の3日前が now。monthDay は JST の +3日。
const daysBefore = (jstDate: string) => new Date(`${jstDate}T00:00:00+09:00`).getTime() - 3 * 86_400_000;

function seed(db: SqliteD1, pets: Array<{ id: string; friend: string; birthday: string }>) {
  db.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-1', 'ch-1', 'A1', 'tok', 'sec');
    INSERT INTO nen_campaign_settings
      (campaign_key, label, category, is_enabled, title, body_text, created_at, updated_at)
    VALUES ('birthday_coupon', '誕生日クーポン', 'birthday', 1, 'おめでとう', '本文', '2026-01-01', '2026-01-01');
    INSERT INTO nen_birthday_coupon_settings
      (id, is_enabled, code_prefix, benefit_label, discount_amount, validity_days, updated_at)
    VALUES ('default', 1, 'NENBDAY', 'お誕生日クーポン', 500, 31, '2026-01-01');
  `);
  for (const pet of pets) {
    db.raw.exec(`
      INSERT INTO friends (id, line_user_id, display_name, is_following, line_account_id, created_at, updated_at)
      VALUES ('${pet.friend}', 'U-${pet.friend}', '飼い主', 1, 'account-1', '2026-01-01', '2026-01-01');
      INSERT INTO nen_pet_profiles (id, friend_id, name, birthday, created_at, updated_at)
      VALUES ('${pet.id}', '${pet.friend}', 'ペット', '${pet.birthday}', '2026-01-01', '2026-01-01');
    `);
  }
}

const counts = (db: SqliteD1) => ({
  issues: (db.raw.prepare(`SELECT COUNT(*) AS n FROM nen_coupon_issues`).get() as { n: number }).n,
  jobs: (db.raw.prepare(`SELECT COUNT(*) AS n FROM nen_delivery_jobs WHERE status = 'pending'`).get() as { n: number }).n,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NEN誕生日クーポン: EC作成失敗の隔離', () => {
  it('1匹のEC失敗で他の子は発行され、失敗した子は発行行を残さず次回へ持ち越す', async () => {
    const db = createTestD1();
    seed(db, [
      { id: 'pet-a', friend: 'friend-a', birthday: '2018-03-15' },
      { id: 'pet-b', friend: 'friend-b', birthday: '2020-03-15' },
    ]);
    // 先に呼ばれる1回だけECが落ちる。どちらの子に当たっても結果は同じはず。
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('ec down', { status: 500 }))
      .mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const failures: NenCouponIssueFailure[] = [];

    const first = await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-03-15')), EC, async (f) => { failures.push(f); });
    expect(first).toEqual({ queued: 1, failed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 失敗した子の発行行は残らない（ECにだけクーポンが残る孤児にしない）。
    expect(counts(db)).toEqual({ issues: 1, jobs: 1 });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.couponCode).toMatch(/^NENBDAY-26-/);
    expect(failures[0]!.lineAccountId).toBe('account-1');

    // 次の走査（翌日分の再実行相当）: ECが直れば同じコードで収束する。
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })));
    const second = await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-03-15')), EC);
    expect(second).toEqual({ queued: 1, failed: 0 });
    expect(counts(db)).toEqual({ issues: 2, jobs: 2 });
    const retriedCode = db.raw.prepare(
      `SELECT coupon_code FROM nen_coupon_issues WHERE pet_id = ?`,
    ).get(failures[0]!.petId) as {  coupon_code: string  } | undefined;
    expect(retriedCode?.coupon_code).toBe(failures[0]!.couponCode);
  });

  it('EC側の重複（409）は成功として予約まで進む', async () => {
    const db = createTestD1();
    seed(db, [{ id: 'pet-a', friend: 'friend-a', birthday: '2018-03-15' }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"success":true,"duplicate":true}', { status: 409 })));
    const result = await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-03-15')), EC);
    expect(result).toEqual({ queued: 1, failed: 0 });
    expect(counts(db)).toEqual({ issues: 1, jobs: 1 });
  });

  it('月日だけ（MM-DD）の誕生日も発行対象になる', async () => {
    const db = createTestD1();
    seed(db, [{ id: 'pet-md', friend: 'friend-md', birthday: '03-15' }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })));
    const result = await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-03-15')), EC);
    expect(result.queued).toBe(1);
    expect(counts(db)).toEqual({ issues: 1, jobs: 1 });
  });

  it('EC連携が無い環境では従来どおりローカルだけで発行する', async () => {
    const db = createTestD1();
    seed(db, [{ id: 'pet-a', friend: 'friend-a', birthday: '2018-03-15' }]);
    const result = await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-03-15')));
    expect(result).toEqual({ queued: 1, failed: 0 });
  });
});
