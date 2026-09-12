import { describe, expect, it } from 'vitest';
import {
  BANNER_PRESETS,
  BANNER_UNITS_BY_QUALITY,
  buildBannerPrompt,
  findBannerPreset,
  validateBannerRequest,
} from './banner-prompt.js';

describe('バナー生成のプロンプト組み立て', () => {
  const preset = findBannerPreset('line_square')!;

  it('バナー生成では、テキストを順番どおり・一字一句そのまま入れるよう指示する', () => {
    const prompt = buildBannerPrompt({
      mode: 'banner',
      preset,
      textLines: ['春の感謝祭', '8/10〜8/23', '今すぐチェック'],
      mainColor: '#FF6600',
      subColor: '#FFFFFF',
      personOption: 'without',
      customPrompt: '桜の花びらを散らす',
      freePrompt: '',
    });
    expect(prompt).toContain('1. 「春の感謝祭」');
    expect(prompt).toContain('2. 「8/10〜8/23」');
    expect(prompt).toContain('3. 「今すぐチェック」');
    expect(prompt).toContain('一字一句そのまま');
    expect(prompt).toContain('#FF6600');
    expect(prompt).toContain('#FFFFFF');
    expect(prompt).toContain('人物は登場させないでください');
    expect(prompt).toContain('桜の花びらを散らす');
    expect(prompt).toContain('禁止事項');
  });

  it('テキストが無いときは「文字は入れない」と指示する', () => {
    const prompt = buildBannerPrompt({
      mode: 'banner',
      preset,
      textLines: [],
      mainColor: null,
      subColor: null,
      personOption: 'with',
      customPrompt: '和風の背景',
      freePrompt: '',
    });
    expect(prompt).toContain('文字は入れないでください');
    expect(prompt).toContain('人物を自然に登場させてください');
  });

  it('フリー生成では入力した文をそのまま先頭に置き、用途を添える', () => {
    const prompt = buildBannerPrompt({
      mode: 'free',
      preset: findBannerPreset('rich_menu_large')!,
      textLines: [],
      mainColor: null,
      subColor: null,
      personOption: 'without',
      customPrompt: '',
      freePrompt: '餃子と生ビールの写真風ビジュアル',
    });
    expect(prompt.startsWith('餃子と生ビールの写真風ビジュアル')).toBe(true);
    expect(prompt).toContain('リッチメニュー');
  });
});

describe('生成条件の検査', () => {
  it('用途・品質・枚数がそろえば通る', () => {
    const result = validateBannerRequest({
      presetKey: 'line_square',
      quality: 'medium',
      count: 2,
      textLines: ['A', ' B ', ''],
      mainColor: '#123456',
    });
    expect(result.ok).toBe(true);
    expect(result.value?.textLines).toEqual(['A', 'B']);
    expect(result.value?.count).toBe(2);
    expect(result.value?.preset.apiSize).toBe('1024x1024');
  });

  it.each([
    [{ quality: 'low', count: 1, textLines: ['A'] }, '用途'],
    [{ presetKey: 'line_square', quality: 'ultra', count: 1, textLines: ['A'] }, '品質'],
    [{ presetKey: 'line_square', quality: 'low', count: 9, textLines: ['A'] }, '枚数'],
    [{ presetKey: 'line_square', quality: 'low', count: 1, textLines: ['A'], mainColor: 'red' }, 'メインカラー'],
    [{ presetKey: 'line_square', quality: 'low', count: 1, textLines: [] }, 'テキスト'],
    [{ presetKey: 'line_square', quality: 'low', count: 1, mode: 'free', freePrompt: '' }, '説明'],
    [{ presetKey: 'line_square', quality: 'low', count: 1, textLines: ['あ'.repeat(41)] }, '40文字'],
  ])('不正な条件は理由つきで断る: %o', (body, fragment) => {
    const result = validateBannerRequest(body as Record<string, unknown>);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(fragment);
  });

  it('品質ごとの単位はライト1・スタンダード3・高精細8', () => {
    expect(BANNER_UNITS_BY_QUALITY).toEqual({ low: 1, medium: 3, high: 8 });
  });

  it('用途はすべて画像生成APIが受け付ける大きさに対応している', () => {
    for (const p of BANNER_PRESETS) {
      expect(['1024x1024', '1536x1024', '1024x1536']).toContain(p.apiSize);
    }
  });
});
