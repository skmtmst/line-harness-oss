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
});
