import { describe, expect, it } from 'vitest';
import {
  addTestLabel,
  buildMessages,
  combinedMessageContent,
  hasRecipientVariablesInParts,
  parseBroadcastMessageParts,
  renderMessageParts,
  unsupportedMessageVariables,
  varyTextMessages,
} from './broadcast-message-set.js';

const bubbles = [
  { id: '1', type: 'text', content: { text: 'こんにちは {{name}}' } },
  { id: '2', type: 'image', content: { originalContentUrl: 'https://e.test/a.jpg', previewImageUrl: 'https://e.test/p.jpg' } },
  { id: '3', type: 'location', content: { state: { location: { title: '本店', address: '東京', latitude: '35.6', longitude: '139.7' } } } },
  { id: '4', type: 'audio', content: { state: { audio: { originalContentUrl: 'https://e.test/a.m4a', duration: '12' } } } },
  { id: '5', type: 'sticker', content: { state: { sticker: { packageId: '446', stickerId: '1988' } } } },
];

describe('一斉配信の複数吹き出し契約', () => {
  it('既存の1通は配列1件として扱う', () => {
    expect(parseBroadcastMessageParts({ messageType: 'text', messageContent: '本文' })).toEqual([
      { id: 'legacy-1', messageType: 'text', messageContent: '本文', altText: undefined },
    ]);
  });

  it('1〜5通を画面の保存形式からLINEの形式へ変換する', () => {
    const parts = parseBroadcastMessageParts({ messageType: 'text', messageContent: 'legacy', messageBubbles: bubbles });
    expect(parts).toHaveLength(5);
    expect(buildMessages(parts).map((message) => message.type)).toEqual([
      'text', 'image', 'location', 'audio', 'sticker',
    ]);
    expect(parts[3].messageContent).toContain('12000');
  });

  it('6通・未対応種別・壊れた中身を送信前に止める', () => {
    expect(() => parseBroadcastMessageParts({ messageType: 'text', messageContent: 'x', messageBubbles: [...bubbles, bubbles[0]] }))
      .toThrow('1 to 5');
    expect(() => parseBroadcastMessageParts({ messageType: 'text', messageContent: 'x', messageBubbles: [{ type: 'coupon', content: {} }] }))
      .toThrow('Unsupported');
    expect(() => parseBroadcastMessageParts({ messageType: 'text', messageContent: 'x', messageBubbles: [{ type: 'image', content: {} }] }))
      .toThrow('originalContentUrl');
  });

  it('全吹き出しをまとめて差し込み検査し、各通を相手ごとに描画する', () => {
    const parts = parseBroadcastMessageParts({
      messageType: 'text',
      messageContent: 'legacy',
      messageBubbles: [
        { type: 'text', content: { text: '{{name}}さん' } },
        { type: 'text', content: { text: '{{var.shop}} / {{unsupported}}' } },
      ],
    });
    expect(hasRecipientVariablesInParts(parts)).toBe(true);
    expect(unsupportedMessageVariables(parts)).toEqual(['unsupported']);
    expect(combinedMessageContent(parts)).toContain('{{var.shop}}');
    const rendered = renderMessageParts(parts.slice(0, 1), { displayName: '田中' });
    expect(rendered[0].messageContent).toBe('田中さん');
  });

  it('テスト表示とバッチ差分は先頭のテキストだけへ付ける', () => {
    const parts = parseBroadcastMessageParts({
      messageType: 'text', messageContent: 'legacy',
      messageBubbles: [
        { type: 'image', content: { originalContentUrl: 'https://e.test/a.jpg', previewImageUrl: 'https://e.test/p.jpg' } },
        { type: 'text', content: { text: '一通目' } },
        { type: 'text', content: { text: '二通目' } },
      ],
    });
    const labelled = addTestLabel(parts);
    expect(labelled[1].messageContent).toContain('【テスト配信】');
    expect(labelled[2].messageContent).toBe('二通目');
    const varied = varyTextMessages(buildMessages(labelled), 1, 2);
    expect(varied).toHaveLength(3);
    expect(varied[2]).toEqual(buildMessages(labelled)[2]);
  });
});
