import { describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  enqueueBirthdayCoupons,
  saveNenBirthdayCouponSetting,
  getNenBirthdayCouponSetting,
} from './nen-engagement.js';

/**
 * 419: NEN誕生日クーポンの2月29日生まれの扱い（3択）。
 * 機能07リマインダと同じ共有規則。既存設定（キー無し）は
 * 従来どおり「平年には届かない」= skip 相当を守る。
 */

function seed(db: SqliteD1) {
  db.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-1', 'ch-1', 'A1', 'tok', 'sec');
    INSERT INTO friends (id, line_user_id, display_name, is_following, line_account_id,
      first_followed_at, current_follow_started_at, created_at, updated_at)
    VALUES ('friend-1', 'U1', 'F1', 1, 'account-1',
      '2026-01-01T00:00:00+09:00', '2026-01-01T00:00:00+09:00',
      '2026-01-01T00:00:00+09:00', '2026-01-01T00:00:00+09:00');
    INSERT INTO nen_pet_profiles (id, friend_id, name, birthday, created_at, updated_at)
    VALUES ('pet-1', 'friend-1', 'こむぎ', '2000-02-29', '2026-01-01', '2026-01-01');
    INSERT INTO nen_campaign_settings
      (campaign_key, label, category, is_enabled, title, body_text, created_at, updated_at)
    VALUES ('birthday_coupon', '誕生日クーポン', 'birthday', 1, 'おめでとう', '本文', '2026-01-01', '2026-01-01');
    INSERT INTO nen_birthday_coupon_settings
      (id, is_enabled, code_prefix, benefit_label, discount_amount, validity_days, updated_at)
    VALUES ('default', 1, 'NENBDAY', 'お誕生日クーポン', 500, 31, '2026-01-01');
  `);
}

async function savePolicy(db: SqliteD1, policy: 'feb28' | 'mar1' | 'skip' | undefined) {
  const base = await getNenBirthdayCouponSetting(db.db, 'account-1');
  await saveNenBirthdayCouponSetting(db.db, 'account-1', {
    ...base!,
    leap_year_policy: policy,
  });
}

async function issues(db: SqliteD1): Promise<Array<{ issue_year: number }>> {
  const rows = await db.db
    .prepare(`SELECT issue_year FROM nen_coupon_issues WHERE pet_id = 'pet-1' ORDER BY issue_year`)
    .all<{ issue_year: number }>();
  return rows.results;
}

// 届ける日（JST）の3日前が now。monthDay は JST の +3日。
const daysBefore = (jstDate: string) => new Date(`${jstDate}T00:00:00+09:00`).getTime() - 3 * 86_400_000;

describe('NEN誕生日クーポン: 2月29日生まれの扱い', () => {
  it("方針'feb28'は平年の2月28日に向けて発行する", async () => {
    const db = createTestD1();
    seed(db);
    await savePolicy(db, 'feb28');

    // 2026-02-28（平年）が誕生日扱い → 3日前の 02-25 に走査
    const { queued } = await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-02-28')));
    expect(queued).toBe(1);
    expect(await issues(db)).toEqual([{ issue_year: 2026 }]);
  });

  it("方針'mar1'は平年の3月1日に向けて発行する", async () => {
    const db = createTestD1();
    seed(db);
    await savePolicy(db, 'mar1');

    expect((await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-02-28')))).queued).toBe(0);
    expect((await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-03-01')))).queued).toBe(1);
    expect(await issues(db)).toEqual([{ issue_year: 2026 }]);
  });

  it("方針'skip'は平年に発行せず、うるう年は2月29日に発行する", async () => {
    const db = createTestD1();
    seed(db);
    await savePolicy(db, 'skip');

    expect((await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-02-28')))).queued).toBe(0);
    expect((await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-03-01')))).queued).toBe(0);
    expect(await issues(db)).toEqual([]);

    expect((await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2028-02-29')))).queued).toBe(1);
    expect(await issues(db)).toEqual([{ issue_year: 2028 }]);
  });

  it('キー無しの既存設定は従来どおり平年に発行しない（skip 相当）', async () => {
    const db = createTestD1();
    seed(db);
    // 419 より前に保存されたアカウント設定を再現（leap_year_policy 無し）
    const base = await getNenBirthdayCouponSetting(db.db, 'account-1');
    await saveNenBirthdayCouponSetting(db.db, 'account-1', base!);
    db.raw.exec(`
      UPDATE account_settings
         SET value = json_remove(value, '$.leap_year_policy')
       WHERE line_account_id = 'account-1' AND key = 'nen.birthday_coupon'
    `);

    const stored = await getNenBirthdayCouponSetting(db.db, 'account-1');
    expect(stored?.leap_year_policy).toBeUndefined();

    expect((await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-02-28')))).queued).toBe(0);
    expect((await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-03-01')))).queued).toBe(0);
    expect((await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2028-02-29')))).queued).toBe(1);
  });

  it('壊れた方針値の入った設定は未設定として安全側（skip）に落ちる', async () => {
    const db = createTestD1();
    seed(db);
    await savePolicy(db, 'feb28');
    db.raw.exec(`
      UPDATE account_settings
         SET value = json_set(value, '$.leap_year_policy', 'feb29')
       WHERE line_account_id = 'account-1' AND key = 'nen.birthday_coupon'
    `);

    const stored = await getNenBirthdayCouponSetting(db.db, 'account-1');
    expect(stored?.leap_year_policy).toBeUndefined();
    expect((await enqueueBirthdayCoupons(db.db, new Date(daysBefore('2026-02-28')))).queued).toBe(0);
  });
});
