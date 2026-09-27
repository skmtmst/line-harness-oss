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
  it('画像・説明・リンクを1つの Flex に直す', () => {
    const result = convertBroadcastAsset('rich_message', '秋の便り', {
      imageUrl: 'https://example.com/a.png',
      description: '新米の季節です',
      actionUrl: 'https://example.com/lp',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.messageType).toBe('flex');
    const bubble = JSON.parse(result.message.messageContent) as Record<string, unknown>;
    expect(bubble.type).toBe('bubble');
    expect(result.message.messageContent).toContain('新米の季節です');
    expect(result.message.messageContent).not.toContain('assetId');
  });

  it('画像が無ければ直し方で止める', () => {
    const result = convertBroadcastAsset('rich_message', '便り', { description: '本文' });
    expect(result.ok).toBe(false);
  });
});

describe('クーポン・リサーチの変換', () => {
  it.each(['coupon', 'research'] as const)('%sは内容とリンク先を読める文にする', (kind) => {
    const result = convertBroadcastAsset(kind, '案内', {
      description: '500円引き',
      actionUrl: 'https://example.com/c',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.messageType).toBe('text');
    expect(result.message.messageContent).toBe('500円引き\nhttps://example.com/c');
    expect(result.message.messageContent).not.toContain('assetId');
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
