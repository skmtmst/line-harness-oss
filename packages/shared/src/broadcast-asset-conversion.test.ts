import { describe, expect, it } from 'vitest';
import {
  convertBroadcastAsset,
  isBroadcastAssetKind,
  validateAssetPayload,
} from './broadcast-asset-conversion.js';

const card = (over: Record<string, unknown> = {}) => ({
  title: 'パネル',
  description: '説明です',
  actionLabel: '詳しく見る',
  actionUrl: 'https://example.com/a',
  ...over,
});

describe('素材の保存時の形', () => {
  it('10枚まで保てる', () => {
    const cards = Array.from({ length: 10 }, (_, i) => card({ title: `パネル${i + 1}` }));
    expect(validateAssetPayload('card_message', { cards })).toBeNull();
  });

  it('11枚は具体的な上限で止める', () => {
    const cards = Array.from({ length: 11 }, () => card());
    expect(validateAssetPayload('card_message', { cards })).toContain('10枚');
  });

  it('「もっと見る」を付けるときは本文9枚までと理由を出す', () => {
    const cards = Array.from({ length: 10 }, () => card());
    const error = validateAssetPayload('card_message', { cards, moreCard: true });
    expect(error).toContain('9枚');
    expect(validateAssetPayload('card_message', { cards: cards.slice(0, 9), moreCard: true })).toBeNull();
  });

  it('タイトルの無いパネルは番号で指す', () => {
    expect(validateAssetPayload('card_message', { cards: [card(), card({ title: '' })] })).toContain('パネル2');
  });
});

describe('カルーセル素材の変換', () => {
  it('パネルをカルーセルの列に直す（内部の管理名は入れない）', () => {
    const result = convertBroadcastAsset('card_message', '夏の案内', { cards: [card()] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.messageType).toBe('carousel');
    const columns = JSON.parse(result.message.messageContent) as Array<Record<string, unknown>>;
    expect(columns).toHaveLength(1);
    expect(columns[0]).toMatchObject({ title: 'パネル', text: '説明です' });
    expect(result.message.messageContent).not.toContain('assetId');
  });

  it('「もっと見る」がONなら末尾に足し、OFFなら足さない', () => {
    const cards = [card()];
    const on = convertBroadcastAsset('card_message', '案内', { cards, moreCard: true });
    const off = convertBroadcastAsset('card_message', '案内', { cards, moreCard: false });
    expect(on.ok && JSON.parse(on.message.messageContent)).toHaveLength(2);
    expect(off.ok && JSON.parse(off.message.messageContent)).toHaveLength(1);
    if (on.ok) {
      const columns = JSON.parse(on.message.messageContent) as Array<{ text: string }>;
      expect(columns[1].text).toBe('もっと見る');
    }
  });

  it('リンク先の無いパネルは番号と直し方で止める', () => {
    const result = convertBroadcastAsset('card_message', '案内', { cards: [card({ actionUrl: '' })] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('パネル1');
    expect(result.error).toContain('リンク先');
  });

  it('画像の有無が混ざると揃え方で止める', () => {
    const result = convertBroadcastAsset('card_message', '案内', {
      cards: [card({ imageUrl: 'https://example.com/a.png' }), card()],
    });
    expect(result.ok).toBe(false);
  });

  it('タイトルありで61文字の説明は通さない', () => {
    const result = convertBroadcastAsset('card_message', '案内', {
      cards: [card({ description: 'あ'.repeat(61) })],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('60文字');
  });
});

describe('リッチメッセージの変換', () => {
  it('タップ範囲を持つイメージマップに直す', () => {
    const result = convertBroadcastAsset('rich_message', '秋の便り', {
      imageUrl: 'https://example.com/a.png',baseUrl:'https://example.com/images/map',baseSize:{width:1040,height:520},tapAreas:[{x:0,y:0,width:100,height:100,actionType:'uri',uri:'https://example.com/lp'}],
      description: '新米の季節です',
      actionUrl: 'https://example.com/lp',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.messageType).toBe('imagemap');
    const bubble = JSON.parse(result.message.messageContent) as Record<string, unknown>;
    expect(bubble.baseSize).toEqual({width:1040,height:520});
    expect(result.message.messageContent).toContain('新米の季節です');
    expect(result.message.messageContent).not.toContain('assetId');
  });

  it('画像が無ければ直し方で止める', () => {
    const result = convertBroadcastAsset('rich_message', '便り', { description: '本文' });
    expect(result.ok).toBe(false);
  });
});

describe('クーポン・リサーチの変換', () => {
  it('リサーチは同じLIFFの回答画面を開くボタンにする', () => {
    const result = convertBroadcastAsset('research', '案内', {
      assetId: 'research-1', description: '答えてください', questions: [{ text: 'お名前', format: 'free', required: true }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.messageType).toBe('flex');
    const card = JSON.parse(result.message.messageContent);
    expect(card.footer.contents[0].action).toEqual({ type: 'uri', label: '回答する', uri: 'https://liff.line.me/{{liff_id}}/?page=research&researchId=research-1' });
  });
  it('未保存・質問なしのリサーチは送信できない', () => {
    expect(convertBroadcastAsset('research', '案内', { description: '旧設定' }).ok).toBe(false);
    expect(convertBroadcastAsset('research', '案内', { assetId: 'r1', description: '旧設定' }).ok).toBe(false);
  });
  it('次に空いている回へ申し込むリサーチを送信できる', () => {
    const result = convertBroadcastAsset('research', '案内', {
      assetId: 'r1', questions: [{ text: 'お名前', format: 'free', required: true }],
      answerActions: [{ actionType: 'event_booking', config: { eventId: 'e1' } }],
    });
    expect(result.ok).toBe(true);
  });

  it('空のクーポンは作り直し方で止める', () => {
    expect(convertBroadcastAsset('coupon', '案内', {}).ok).toBe(false);
  });
});

describe('種類の判定', () => {
  it('4種類だけを素材とみなす', () => {
    expect(isBroadcastAssetKind('card_message')).toBe(true);
    expect(isBroadcastAssetKind('carousel')).toBe(false);
    expect(isBroadcastAssetKind('text')).toBe(false);
  });
});
