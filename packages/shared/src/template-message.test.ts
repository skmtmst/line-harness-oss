import { describe, expect, it } from 'vitest';

import {
  TEMPLATE_TEXT_MAX_CHARACTERS,
  countTemplateTextCharacters,
} from './template-message';

describe('template message contract', () => {
  it('画面とWorkerで共有する上限は5,000文字', () => {
    expect(TEMPLATE_TEXT_MAX_CHARACTERS).toBe(5_000);
  });

  it('サロゲートペアの絵文字を1文字として数える', () => {
    expect(countTemplateTextCharacters('あ🌿い')).toBe(3);
  });

  it('改行を1文字として数える', () => {
    expect(countTemplateTextCharacters('一行目\n二行目')).toBe(7);
  });

  it('空文字列を0文字として数える', () => {
    expect(countTemplateTextCharacters('')).toBe(0);
  });

  it('ASCII文字列LINEを4文字として数える', () => {
    expect(countTemplateTextCharacters('LINE')).toBe(4);
  });

  it('ASCII数字文字列123を3文字として数える', () => {
    expect(countTemplateTextCharacters('123')).toBe(3);
  });

  it('日本語とASCIIが混在する文字列然NENを4文字として数える', () => {
    expect(countTemplateTextCharacters('然NEN')).toBe(4);
  });
});
