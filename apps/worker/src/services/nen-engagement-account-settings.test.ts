import { describe, expect, it } from 'vitest';
import {
  enqueuePostShippingFollowUps,
  getNenBirthdayCouponSetting,
  getNenCampaign,
  saveNenBirthdayCouponSetting,
  saveNenCampaignAccountSetting,
  type CampaignRow,
} from './nen-engagement.js';

const baseCampaigns = new Map<string, CampaignRow>([
  ['arrival_check', {
    campaign_key: 'arrival_check', label: '到着後の確認', category: 'follow_up',
    trigger_event: 'ec.order.shipped', delay_days: 5, delivery_time: '10:00', is_enabled: 1,
    title: '共通の到着確認', body_text: '共通本文', button_label: null, button_url: null,
    image_url: null, updated_at: '2026-08-01 00:00:00',
  }],
  ['review_request', {
    campaign_key: 'review_request', label: '口コミのお願い', category: 'follow_up',
    trigger_event: 'ec.order.shipped', delay_days: 10, delivery_time: '10:00', is_enabled: 1,
    title: '口コミのお願い', body_text: '共通本文', button_label: null, button_url: null,
    image_url: null, updated_at: '2026-08-01 00:00:00',
  }],
  ['cross_sell', {
    campaign_key: 'cross_sell', label: '次の商品の案内', category: 'follow_up',
    trigger_event: 'ec.order.shipped', delay_days: 14, delivery_time: '10:00', is_enabled: 1,
    title: '次の商品', body_text: '共通本文', button_label: null, button_url: null,
    image_url: null, updated_at: '2026-08-01 00:00:00',
  }],
]);

function database() {
  const settings = new Map<string, string>();
  const jobs: Array<{ accountId: string; campaignKey: string; snapshot: string }> = [];
  const birthdayBase = {
    is_enabled: 1, code_prefix: 'NENBDAY', benefit_label: '共通クーポン',
    discount_amount: 500, validity_days: 31, updated_at: '2026-08-01 00:00:00',
  };
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { binds = values; return statement; },
        async first() {
          if (sql.includes('FROM nen_campaign_settings')) return baseCampaigns.get(String(binds[0])) ?? null;
          if (sql.includes('FROM nen_birthday_coupon_settings')) return birthdayBase;
          if (sql.includes('SELECT value FROM account_settings')) {
            const value = settings.get(`${String(binds[0])}:${String(binds[1])}`);
            return value ? { value } : null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO account_settings')) {
            settings.set(`${String(binds[1])}:${String(binds[2])}`, String(binds[3]));
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes('INSERT OR IGNORE INTO nen_delivery_jobs')) {
            jobs.push({ accountId: String(binds[3]), campaignKey: String(binds[1]), snapshot: String(binds[6]) });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, jobs, settings };
}

describe('NEN account settings', () => {
  it('keeps campaign and birthday coupon settings separate for each LINE account', async () => {
    const { db } = database();
    const base = await getNenCampaign(db, 'arrival_check', 'account-a');
    expect(base?.title).toBe('共通の到着確認');

    await saveNenCampaignAccountSetting(db, 'account-a', { ...base!, title: 'A店だけの到着確認' });
    expect((await getNenCampaign(db, 'arrival_check', 'account-a'))?.title).toBe('A店だけの到着確認');
    expect((await getNenCampaign(db, 'arrival_check', 'account-b'))?.title).toBe('共通の到着確認');

    const coupon = await getNenBirthdayCouponSetting(db, 'account-a');
    await saveNenBirthdayCouponSetting(db, 'account-a', { ...coupon!, benefit_label: 'A店だけの特典' });
    expect((await getNenBirthdayCouponSetting(db, 'account-a'))?.benefit_label).toBe('A店だけの特典');
    expect((await getNenBirthdayCouponSetting(db, 'account-b'))?.benefit_label).toBe('共通クーポン');
  });

  it('fixes the selected account copy into queued follow-up jobs', async () => {
    const { db, jobs } = database();
    const base = await getNenCampaign(db, 'arrival_check', 'account-a');
    await saveNenCampaignAccountSetting(db, 'account-a', { ...base!, title: 'A店の予約時見出し' });

    const created = await enqueuePostShippingFollowUps(db, {
      event_id: 'event-1', event_type: 'ec.order.shipped', occurred_at: '2026-08-28T01:00:00Z',
      line_user_id: 'U1', shipping: { shipped_at: '2026-08-28T01:00:00Z' },
    }, 'friend-a', 'account-a');

    expect(created).toBe(3);
    expect(jobs.every((job) => job.accountId === 'account-a')).toBe(true);
    const arrival = jobs.find((job) => job.campaignKey === 'arrival_check');
    expect(JSON.parse(arrival!.snapshot)).toMatchObject({ title: 'A店の予約時見出し' });
  });

  it('does not silently fall back to the shared copy when an account override is broken', async () => {
    const { db, settings } = database();
    settings.set('account-a:nen.campaign.arrival_check', '{broken-json');
    settings.set('account-a:nen.birthday_coupon', JSON.stringify({
      is_enabled: 1,
      code_prefix: 'NENBDAY',
      benefit_label: '壊れた設定',
      discount_amount: 500,
      validity_days: 0,
    }));
    expect(await getNenCampaign(db, 'arrival_check', 'account-a')).toBeNull();
    expect(await getNenBirthdayCouponSetting(db, 'account-a')).toBeNull();
    expect((await getNenCampaign(db, 'arrival_check', 'account-b'))?.title).toBe('共通の到着確認');
    expect((await getNenBirthdayCouponSetting(db, 'account-b'))?.benefit_label).toBe('共通クーポン');
  });
});
