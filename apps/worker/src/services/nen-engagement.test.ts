import { describe, expect, it } from 'vitest';
import {
  birthdayDeliveryTarget,
  buildDefaultColumnIntro,
  buildNenDeliveryMessages,
  buildNenFlexMessage,
  readNenCampaignSnapshot,
} from './nen-engagement.js';

const campaign = {
  campaign_key: 'shipping_confirmed',
  label: '発送完了',
  category: 'transactional',
  delay_days: 0,
  delivery_time: '10:00',
  is_enabled: 1,
  title: '商品を発送しました',
  body_text: '到着まで、もう少しだけお待ちください。',
  button_label: '配送状況を見る',
  button_url: null,
  image_url: null,
};

describe('buildNenFlexMessage', () => {
  it('schedules birthday delivery at 10:00 JST three days before, including year boundaries', () => {
    expect(birthdayDeliveryTarget(new Date('2026-08-27T15:00:00.000Z'))).toMatchObject({
      issueYear: 2026, monthDay: '08-31', deliveryAt: new Date('2026-08-28T01:00:00.000Z'),
    });
    expect(birthdayDeliveryTarget(new Date('2026-12-28T15:00:00.000Z'))).toMatchObject({
      issueYear: 2027, monthDay: '01-01', deliveryAt: new Date('2026-12-29T01:00:00.000Z'),
    });
  });

  it('uses the copy fixed when the job was queued', () => {
    const snapshot = JSON.stringify({ ...campaign, title: '予約時の見出し' });
    const fixed = readNenCampaignSnapshot(snapshot, campaign.campaign_key);
    expect(fixed?.title).toBe('予約時の見出し');

    const changedCurrentSetting = { ...campaign, title: '後から編集した見出し' };
    expect(buildNenDeliveryMessages(fixed!, {})).not.toEqual(
      buildNenDeliveryMessages(changedCurrentSetting, {}),
    );
  });

  it('rejects a snapshot belonging to another campaign', () => {
    expect(readNenCampaignSnapshot(JSON.stringify(campaign), 'review_request')).toBeNull();
    expect(readNenCampaignSnapshot(null, campaign.campaign_key)).toBeNull();
  });

  it('keeps mandatory order facts while using editable campaign copy', () => {
    const message = buildNenFlexMessage(campaign, {
      event: {
        event_id: 'event-12345678',
        event_type: 'ec.order.shipped',
        occurred_at: '2026-08-09T12:00:00+09:00',
        line_user_id: 'U00000000000000000000000000000000',
        order: {
          number: 'NEN-1001',
          items: [{ name: '鹿肉ミンチ', quantity: 2 }],
          total: 2860,
        },
        shipping: { carrier: 'ヤマト運輸', tracking_number: '1234-5678-9012', tracking_url: 'https://example.com/tracking/1001' },
      },
    });

    expect(message.type).toBe('flex');
    expect(JSON.stringify(message)).toContain('商品を発送しました');
    expect(JSON.stringify(message)).toContain('注文番号：NEN-1001');
    expect(JSON.stringify(message)).toContain('鹿肉ミンチ × 2');
    expect(JSON.stringify(message)).toContain('合計：¥2,860');
    expect(JSON.stringify(message)).toContain('配送会社：ヤマト運輸');
    expect(JSON.stringify(message)).toContain('送り状番号：1234-5678-9012');
    expect(JSON.stringify(message)).toContain('https://example.com/tracking/1001');
  });

  it('renders a column as a rich message with its eye-catch and article link', () => {
    const message = buildNenFlexMessage({
      ...campaign,
      campaign_key: 'column',
      title: 'NENコラム',
      button_label: 'コラムを読む',
    }, {
      article: {
        title: 'ジビエが愛犬の食事に選ばれる理由',
        excerpt: '鹿肉の特徴を分かりやすくご紹介します。',
        image_url: 'https://example.com/column.jpg',
        article_url: 'https://example.com/column/gibier',
      },
    });

    const rendered = JSON.stringify(message);
    expect(rendered).toContain('ジビエが愛犬の食事に選ばれる理由');
    expect(rendered).toContain('https://example.com/column.jpg');
    expect(rendered).toContain('https://example.com/column/gibier');
  });

  it('sends an editable greeting before a column card', () => {
    const messages = buildNenDeliveryMessages({
      ...campaign,
      campaign_key: 'column',
      title: 'NENコラム',
      button_label: 'コラムを読む',
    }, {
      article: {
        title: '鹿肉の選び方', excerpt: '原材料表示の基本をご紹介します。',
        intro_text: 'こんにちは。\n今回の記事のポイントをご案内します。',
        article_url: 'https://example.com/column',
      },
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: 'text', text: 'こんにちは。\n今回の記事のポイントをご案内します。' });
    expect(messages[1].type).toBe('flex');
  });

  it('creates a friendly default column greeting from title and excerpt', () => {
    const intro = buildDefaultColumnIntro('鹿肉の選び方', '原材料表示の基本をご紹介します。');
    expect(intro).toContain('こんにちは、然-NEN-です');
    expect(intro).toContain('「鹿肉の選び方」');
    expect(intro).toContain('原材料表示の基本をご紹介します。');
  });

  it('shows a pet-specific birthday coupon code and expiry date', () => {
    const message = buildNenFlexMessage({
      ...campaign,
      campaign_key: 'birthday_coupon',
      title: '{{pet_name}}ちゃん、お誕生日おめでとうございます',
      button_label: 'クーポンを使う',
      button_url: 'https://stg.nen-petfood.com/products/list',
    }, {
      pet: { name: 'こむぎ' },
      coupon: { code: 'NENBDAY-26-ABC12345', expires_at: '2026-08-31 23:59:59' },
    });

    const rendered = JSON.stringify(message);
    expect(rendered).toContain('こむぎちゃん、お誕生日おめでとうございます');
    expect(rendered).toContain('NENBDAY-26-ABC12345');
    expect(rendered).toContain('2026-08-31');
  });
});
