import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_TEXT_MAX_CHARACTERS,
  validateTemplateMessage,
} from './template-message-validation.js';

describe('テンプレート本文の文字数検査', () => {
  it('5,000文字ちょうどのテキストは保存できる', () => {
    expect(validateTemplateMessage('text', 'あ'.repeat(TEMPLATE_TEXT_MAX_CHARACTERS)))
      .toEqual({ ok: true });
  });

  it('5,001文字のテキストは画面で扱える契約を返す', () => {
    expect(validateTemplateMessage('text', 'あ'.repeat(TEMPLATE_TEXT_MAX_CHARACTERS + 1)))
      .toEqual({
        ok: false,
        code: 'TEMPLATE_TEXT_TOO_LONG',
        error: '本文は5,000文字までです。いまは5,001文字です。',
        field: 'messageContent',
        maxCharacters: 5_000,
        actualCharacters: 5_001,
      });
  });

  it('絵文字をUTF-16の2文字ではなく表示上の1文字として数える', () => {
    expect(validateTemplateMessage('text', '🌿'.repeat(TEMPLATE_TEXT_MAX_CHARACTERS)))
      .toEqual({ ok: true });
  });

  it('Flexや画像はテキスト本文の上限へ混ぜない', () => {
    const longContent = 'a'.repeat(TEMPLATE_TEXT_MAX_CHARACTERS + 1);
    expect(validateTemplateMessage('flex', longContent)).toEqual({ ok: true });
    expect(validateTemplateMessage('image', longContent)).toEqual({ ok: true });
  });
});
