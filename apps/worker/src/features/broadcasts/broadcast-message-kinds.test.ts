/*
 * JSON がそのままトークへ届かないよう、一斉配信とシナリオが各メッセージ種別を同じ結果へ組み立てることを確かめる。
 */
import { describe, it, expect } from 'vitest';
import { buildMessage as broadcastBuild } from './broadcast.js';
import { buildMessage as scenarioBuild } from '../../services/step-delivery.js';

const CASES: Array<{ kind: string; content: string; expect: string }> = [
  { kind: 'text', content: 'こんにちは', expect: 'text' },
  {
    kind: 'image',
    content: JSON.stringify({ originalContentUrl: 'https://e.com/a.jpg', previewImageUrl: 'https://e.com/a.jpg' }),
    expect: 'image',
  },
  {
    kind: 'flex',
    content: JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } }),
    expect: 'flex',
  },
  {
    kind: 'location',
    content: JSON.stringify({ title: '店舗', address: '東京都', latitude: 35.6, longitude: 139.7 }),
    expect: 'location',
  },
  {
    kind: 'video',
    content: JSON.stringify({ originalContentUrl: 'https://e.com/v.mp4', previewImageUrl: 'https://e.com/v.jpg' }),
    expect: 'video',
  },
  {
    kind: 'audio',
    content: JSON.stringify({ originalContentUrl: 'https://e.com/a.m4a', duration: 12000 }),
    expect: 'audio',
  },
  { kind: 'sticker', content: JSON.stringify({ packageId: '446', stickerId: '1988' }), expect: 'sticker' },
  {
    kind: 'carousel',
    content: JSON.stringify([{ title: '然-NEN- チキン', text: '国産むね肉', actions: [] }]),
    expect: 'template',
  },
];

describe('一斉配信の種別', () => {
  for (const c of CASES) {
    it(`${c.kind} を組み立てられる`, () => {
      const built = broadcastBuild(c.kind, c.content) as { type: string };
      expect(built.type).toBe(c.expect);
    });
  }

  it('シナリオとまったく同じ結果になる', () => {
    // 両方の入口で組み立て結果が一致することを確かめる。
    for (const c of CASES) {
      expect(broadcastBuild(c.kind, c.content)).toEqual(scenarioBuild(c.kind, c.content));
    }
  });

  it('読めない中身はテキストに落とす（配信を止めない）', () => {
    // 1通の中身が壊れているだけで、配信全体やその人の以降の配信まで
    // 止まると困る。
    expect(broadcastBuild('sticker', '{こわれ')).toEqual({ type: 'text', text: '{こわれ' });
    expect(broadcastBuild('location', JSON.stringify({ title: '店舗' }))).toMatchObject({ type: 'text' });
  });
});
