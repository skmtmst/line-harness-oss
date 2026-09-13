import { describe, expect, it } from 'vitest';
import {
  BANNER_PRESETS,
  buildBannerPrompt,
  findBannerPreset,
  resolveBannerQuality,
  validateBannerRequest,
} from './banner-prompt.js';

describe('バナー生成のプロンプト組み立て', () => {
  const preset = findBannerPreset('line_rich_message')!;

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
      preset: findBannerPreset('line_rich_menu_large')!,
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

  it('APIの大きさと縦横比が違う用途では、重要な文字を中央に収めるよう指示する', () => {
    const prompt = buildBannerPrompt({
      mode: 'banner',
      preset: findBannerPreset('line_rich_menu_small')!,
      textLines: ['メニュー'],
      mainColor: null,
      subColor: null,
      personOption: 'without',
      customPrompt: '',
      freePrompt: '',
    });
    expect(prompt).toContain('3:1 に切り抜いて使う');
    const square = buildBannerPrompt({ mode: 'banner', preset, textLines: ['A'], mainColor: null, subColor: null, personOption: 'without', customPrompt: '', freePrompt: '' });
    expect(square).not.toContain('切り抜いて使う');
  });
});

describe('生成条件の検査', () => {
  it('用途・品質・枚数がそろえば通る', () => {
    const result = validateBannerRequest({
      presetKey: 'line_rich_message',
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
    [{ count: 1, textLines: ['A'] }, '用途'],
    [{ presetKey: 'line_rich_message', count: 9, textLines: ['A'] }, '枚数'],
    [{ presetKey: 'line_rich_message', count: 1, textLines: ['A'], mainColor: 'red' }, 'メインカラー'],
    [{ presetKey: 'line_rich_message', count: 1, textLines: [] }, 'テキスト'],
    [{ presetKey: 'line_rich_message', count: 1, mode: 'free', freePrompt: '' }, '説明'],
    [{ presetKey: 'line_rich_message', count: 1, textLines: ['あ'.repeat(41)] }, '40文字'],
  ])('不正な条件は理由つきで断る: %o', (body, fragment) => {
    const result = validateBannerRequest(body as Record<string, unknown>);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(fragment);
  });

  it('品質は運用者に選ばせず、既定はスタンダード（medium）', () => {
    expect(resolveBannerQuality(undefined)).toBe('medium');
    expect(resolveBannerQuality('ultra')).toBe('medium');
    expect(resolveBannerQuality('high')).toBe('high');
  });

  it('用途はすべて画像生成APIが受け付ける大きさに対応し、LINE と SNS の両方がある', () => {
    for (const p of BANNER_PRESETS) {
      expect(['1024x1024', '1536x1024', '1024x1536']).toContain(p.apiSize);
      expect(p.targetWidth).toBeGreaterThan(0);
      expect(p.targetHeight).toBeGreaterThan(0);
    }
    expect(BANNER_PRESETS.some((p) => p.group === 'line')).toBe(true);
    expect(BANNER_PRESETS.some((p) => p.group === 'sns')).toBe(true);
    expect(new Set(BANNER_PRESETS.map((p) => p.key)).size).toBe(BANNER_PRESETS.length);
  });
});

describe('参照画像（35-2）', () => {
  const preset = BANNER_PRESETS[0];
  it('描き直すと参考にするで先頭の言い方が変わる', () => {
    const base = { mode: 'banner' as const, preset, textLines: ['秋の感謝祭'], mainColor: null, subColor: null, personOption: 'without' as const, customPrompt: '', freePrompt: '' };
    expect(buildBannerPrompt({ ...base, referenceMode: 'edit' })).toMatch(/^添付した画像を土台にして描き直してください/);
    expect(buildBannerPrompt({ ...base, referenceMode: 'inspire' })).toMatch(/^添付した画像は参考です/);
    expect(buildBannerPrompt({ ...base, referenceMode: null })).not.toContain('添付した画像');
  });

  it('参照画像があるときは使い方が必須。描き直すなら文字も指示も無くてよい', () => {
    const body = { presetKey: preset.key, count: 1, textLines: [], personOption: 'without' };
    expect(validateBannerRequest({ ...body, referenceImageId: 'img-1' }).error).toContain('使い方');
    expect(validateBannerRequest({ ...body, referenceImageId: 'img-1', referenceMode: 'edit' }).ok).toBe(true);
    expect(validateBannerRequest({ ...body, referenceImageId: 'img-1', referenceMode: 'inspire' }).error).toContain('テキストか');
    expect(validateBannerRequest({ ...body, referenceImageId: 42, referenceMode: 'edit' }).error).toContain('参照画像');
    const ok = validateBannerRequest({ ...body, textLines: ['a'], referenceImageId: ' img-2 ', referenceMode: 'inspire' });
    expect(ok.value?.referenceImageId).toBe('img-2');
    expect(ok.value?.referenceMode).toBe('inspire');
    expect(validateBannerRequest({ ...body, textLines: ['a'] }).value?.referenceImageId).toBeNull();
  });
});
