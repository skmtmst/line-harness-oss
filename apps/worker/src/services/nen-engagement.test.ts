import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEN_CAMPAIGN_BODY_MAX_LENGTH } from '@line-crm/shared';
import type { FlexMessage } from '@line-crm/line-sdk';
import {
  birthdayDeliveryTarget,
  buildDefaultColumnIntro,
  buildNenDeliveryMessages,
  buildNenFlexMessage,
  parseNenCampaignAfterActions,
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
  it('keeps only supported NEN editor actions', () => {
    expect(parseNenCampaignAfterActions([
      { kind: 'open_form', formId: 'form-review', formName: ' 口コミ ', buttonLabel: '感想を書く' },
      { kind: 'award_mileage', amount: 200, trigger: 'form_submitted' },
    ])).toEqual([
      { kind: 'open_form', formId: 'form-review', formName: '口コミ', buttonLabel: '感想を書く' },
      { kind: 'award_mileage', amount: 200, trigger: 'form_submitted' },
    ]);
    expect(parseNenCampaignAfterActions([{ kind: 'award_mileage', amount: 0, trigger: 'form_submitted' }])).toEqual([]);
  });

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

  describe('送信直前の切り詰め（#659差し戻し1点目・司令塔裁定: 発動したら記録に残す）', () => {
    afterEach(() => { vi.restoreAllMocks() });

    it('保存時の上限を通っていても、差し込み展開後は送信直前に採用上限で切り、発動したことを記録する', () => {
      // body_text は3,600字（保存時の上限4,500字以内）で、{{pet_name}}を
      // 300回含む。保存できるペット名の上限いっぱい（40字）で展開すると
      // 300 * 40 = 12,000字になり、切らなければ大幅に上限を超える。
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const longPetName = 'あ'.repeat(40);
      const message = buildNenFlexMessage({
        ...campaign,
        body_text: '{{pet_name}}'.repeat(300),
      }, { pet: { name: longPetName } });

      const bubble = (message as FlexMessage).contents as { body: { contents: Array<{ type: string; text?: string }> } };
      const bodyNode = bubble.body.contents[1];
      expect(bodyNode.text?.length).toBe(NEN_CAMPAIGN_BODY_MAX_LENGTH);
      expect(bodyNode.text?.startsWith(longPetName)).toBe(true);

      // この truncate は、保存時の判定が効いていれば絶対に発動しないはず。
      // 発動したら不具合が起きているということなので、黙って切らず記録する。
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
      expect(logged).toMatchObject({
        event: 'nen_body_truncated_at_send',
        campaignKey: campaign.campaign_key,
        field: 'body',
        beforeLength: 300 * 40,
        afterLength: NEN_CAMPAIGN_BODY_MAX_LENGTH,
        droppedLength: 300 * 40 - NEN_CAMPAIGN_BODY_MAX_LENGTH,
      });
    });

    it('差し込み後に上限内に収まる本文はそのまま切られず、記録も残さない', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const message = buildNenFlexMessage(campaign, { pet: { name: 'こむぎ' } });
      const bubble = (message as FlexMessage).contents as { body: { contents: Array<{ type: string; text?: string }> } };
      expect(bubble.body.contents[1].text).toBe(campaign.body_text);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
