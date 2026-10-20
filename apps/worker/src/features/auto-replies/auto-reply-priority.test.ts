import { describe, expect, it } from 'vitest';
import { matchesMessageKind } from './auto-reply.js';

describe('対象のメッセージ種別', () => {
  it('設定が無ければ何でも対象', () => {
    expect(matchesMessageKind({ message_kinds_json: null }, 'image')).toBe(true);
    expect(matchesMessageKind({}, 'sticker')).toBe(true);
  });

  it('指定した種別だけ対象になる', () => {
    const rule = { message_kinds_json: '["text"]' };
    expect(matchesMessageKind(rule, 'text')).toBe(true);
    expect(matchesMessageKind(rule, 'image')).toBe(false);
  });

  it('複数指定できる', () => {
    const rule = { message_kinds_json: '["text","postback"]' };
    expect(matchesMessageKind(rule, 'postback')).toBe(true);
    expect(matchesMessageKind(rule, 'sticker')).toBe(false);
  });

  it('種別を省略したら text として扱う', () => {
    expect(matchesMessageKind({ message_kinds_json: '["text"]' })).toBe(true);
    expect(matchesMessageKind({ message_kinds_json: '["image"]' })).toBe(false);
  });

  it('空の配列は「絞らない」として扱う', () => {
    // 保存時に null へ寄せているが、古い行に残っている可能性がある。
    expect(matchesMessageKind({ message_kinds_json: '[]' }, 'image')).toBe(true);
  });

  it('壊れた設定でも返す側に倒す', () => {
    // 設定が読めないからといって返さない、では自動応答が黙って消える。
    expect(matchesMessageKind({ message_kinds_json: 'not json' }, 'text')).toBe(true);
    expect(matchesMessageKind({ message_kinds_json: '{"a":1}' }, 'text')).toBe(true);
  });
});
