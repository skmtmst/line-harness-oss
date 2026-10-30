import { describe, expect, it } from 'vitest';
import { convertBroadcastAsset, validateAssetPayload } from './broadcast-asset-conversion.js';
import { couponPresentation, defaultCouponInstructions } from './coupon-presentation.js';

const legacy = { assetId: 'coupon-1', title: '以前の券', description: 'お店で見せてください', startsAt: '2026-10-01T00:00', endsAt: '2026-11-30T23:59', oncePerFriend: true };
const extended = { ...legacy, couponType: 'discount', discount: { mode: 'amount', amountYen: 500 }, conditions: '3,000円以上のお支払いで利用可能', code: { text: 'AUTUMN500' }, instructions: defaultCouponInstructions() };

function flex(payload: typeof legacy & Record<string, unknown>) {
  const result = convertBroadcastAsset('coupon', '管理用の名前', payload);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return JSON.parse(result.message.messageContent);
}

describe('クーポンの追加情報', () => {
  it('旧クーポンは現在の内容・順序・postbackのままで、新しい値を補完しない', () => {
    const snapshot = JSON.stringify(legacy), card = flex(legacy);
    expect(card.body.contents.map((item: { text: string }) => item.text)).toEqual([
      '以前の券', 'お店で見せてください', '有効期間：2026-10-01T00:00〜2026-11-30T23:59',
      'お店で確認してから「使う」を押してください', '1人1回まで',
    ]);
    expect(card.footer.contents[0].action).toEqual({ type: 'postback', label: '使う', data: 'coupon_use:coupon-1' });
    expect(JSON.stringify(legacy)).toBe(snapshot);
    expect(validateAssetPayload('coupon', { ...legacy, title: 'あ'.repeat(61), instructions: 'あ'.repeat(501) })).toBeNull();
  });

  it('保存された割引・条件・コード・ガイドを実際のLINEカードへ渡す', () => {
    expect(validateAssetPayload('coupon', extended)).toBeNull();
    const card = flex(extended), texts = JSON.stringify(card.body.contents);
    expect(card.body.contents[0].contents.map((item: { text: string }) => item.text)).toEqual(['割引', '1回のみ使用可能']);
    for (const value of ['500 円引き', extended.conditions, 'クーポンコード：AUTUMN500', extended.instructions, '日本時間（UTC+09:00）']) expect(texts).toContain(value.replaceAll('\n', '\\n'));
    expect(texts).not.toContain('お店で見せてください');
    expect(card.footer.contents[0].action.data).toBe('coupon_use:coupon-1');
  });

  it.each([
    [{ mode: 'percent', percent: 20 }, '20%引き', ''],
    [{ mode: 'price', beforeYen: 1000, afterYen: 0 }, '0 円', '1,000 円'],
    [{ mode: 'none' }, '', ''],
  ])('割引形式と金額なしを共通の表示にする: %j', (discount, benefit, beforePrice) => {
    const payload = { ...extended, discount };
    expect(validateAssetPayload('coupon', payload)).toBeNull();
    expect(couponPresentation(payload, '名前')).toMatchObject({ benefit, beforePrice });
    const card = flex(payload);
    if (beforePrice) expect(card.body.contents.find((item: { text: string }) => item.text === beforePrice)).toMatchObject({ decoration: 'line-through' });
  });

  it('種類・コード非表示と無制限を保持する', () => {
    const payload = { ...extended, couponType: 'none', discount: { mode: 'none' }, code: null, oncePerFriend: false };
    expect(validateAssetPayload('coupon', payload)).toBeNull();
    const card = flex(payload), text = JSON.stringify(card);
    expect(card.body.contents[0].contents.map((item: { text: string }) => item.text)).toEqual(['期間中は何回でも']);
    expect(text).not.toContain('AUTUMN500');
    expect(text).not.toContain('円引き');
    expect(defaultCouponInstructions(false)).toContain('何回でも');
  });

  it.each([
    { couponType: 'cashback' }, { title: 'あ'.repeat(61) }, { conditions: 'あ'.repeat(31) },
    { conditions: 30 }, { instructions: 'あ'.repeat(501) }, { instructions: 500 },
    { code: {} }, { code: { text: '' } }, { code: { text: 'a\nb' } }, { code: { text: 'a'.repeat(101) } },
    { discount: { mode: 'amount', amountYen: 0 } }, { discount: { mode: 'amount', amountYen: 10_000_000 } },
    { discount: { mode: 'amount', amountYen: 1.5 } }, { discount: { mode: 'amount', amountYen: '500' } },
    { discount: { mode: 'percent', percent: 0 } }, { discount: { mode: 'percent', percent: 100 } },
    { discount: { mode: 'price', beforeYen: 100, afterYen: 100 } }, { discount: { mode: 'price', beforeYen: 100, afterYen: -1 } },
    { discount: { mode: 'other' } }, { couponType: 'none' },
  ])('不正な新しい設定を保存と配信の両方で止める: %j', (patch) => {
    const payload = { ...extended, ...patch };
    expect(validateAssetPayload('coupon', payload)).not.toBeNull();
    expect(convertBroadcastAsset('coupon', '名前', payload).ok).toBe(false);
  });

  it('LIFFがガイドを読むまでは説明なしの形を保存・配信しない', () => {
    for (const instructions of ['案内', 'あ'.repeat(600)]) {
      const payload = { ...legacy, description: '', instructions };
      expect(validateAssetPayload('coupon', payload)).not.toBeNull();
      expect(convertBroadcastAsset('coupon', '名前', payload).ok).toBe(false);
    }
  });

  it('新しい表示でも抽選拒否・期間・利用回数の検査を外さない', () => {
    for (const patch of [{ lottery: true }, { endsAt: legacy.startsAt }, { maxUsesPerFriend: 0 }]) {
      expect(validateAssetPayload('coupon', { ...extended, ...patch })).not.toBeNull();
    }
  });
});
