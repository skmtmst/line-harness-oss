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
      baseColor: null,
      mainColor: '#FF6600',
      subColor: '#FFFFFF',
      accentColor: null,
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
      baseColor: null,
      mainColor: null,
      subColor: null,
      accentColor: null,
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
      baseColor: null,
      mainColor: null,
      subColor: null,
      accentColor: null,
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
      baseColor: null,
      mainColor: null,
      subColor: null,
      accentColor: null,
      personOption: 'without',
      customPrompt: '',
      freePrompt: '',
    });
    expect(prompt).toContain('3:1 に切り抜いて使う');
    const square = buildBannerPrompt({ mode: 'banner', preset, textLines: ['A'], baseColor: null, mainColor: null, subColor: null, accentColor: null, personOption: 'without', customPrompt: '', freePrompt: '' });
    expect(square).not.toContain('切り抜いて使う');
  });

  it('色は4つの役割それぞれを、使う場所まで言い切って指示する（★BG-B KkTNS）', () => {
    const prompt = buildBannerPrompt({
      mode: 'banner',
      preset,
      textLines: ['A'],
      baseColor: '#FFFFFF',
      mainColor: '#D7263D',
      subColor: '#F3E9DC',
      accentColor: '#FFD400',
      personOption: 'without',
      customPrompt: '',
      freePrompt: '',
    });
    expect(prompt).toContain('背景のベースカラーは #FFFFFF');
    expect(prompt).toContain('メインカラーは #D7263D');
    expect(prompt).toContain('サブカラーとして #F3E9DC');
    expect(prompt).toContain('強調カラー #FFD400');
  });

  it('指定なしの役割は文を出さない', () => {
    const prompt = buildBannerPrompt({
      mode: 'banner',
      preset,
      textLines: ['A'],
      baseColor: null,
      mainColor: '#D7263D',
      subColor: null,
      accentColor: null,
      personOption: 'without',
      customPrompt: '',
      freePrompt: '',
    });
    expect(prompt).toContain('メインカラーは #D7263D');
    expect(prompt).not.toContain('ベースカラー');
    expect(prompt).not.toContain('サブカラー');
    expect(prompt).not.toContain('強調カラー');
  });
});

/*
 * 行ごとの「強調」（承認: musubo-design/バナー生成.pen フレーム `g64HOD`・
 * 2026-10-06・利用者回答「この案で承認する」）。強調した行だけを強調カラーで
 * 目立たせる。空の行を落としても、強調が別の行へずれないことを押さえる。
 */
describe('行ごとの「強調」（承認 g64HOD・2026-10-06）', () => {
  const preset = findBannerPreset('line_rich_message')!;

  it('強調した行にだけ「特に目立たせる」を付ける', () => {
    const prompt = buildBannerPrompt({
      mode: 'banner',
      preset,
      textLines: ['春の感謝祭', '8/10〜8/23', '今すぐチェック'],
      emphasisLines: [false, false, true],
      baseColor: null,
      mainColor: null,
      subColor: null,
      accentColor: null,
      personOption: 'without',
      customPrompt: '',
      freePrompt: '',
    });
    expect(prompt).toContain('1. 「春の感謝祭」（メインのキャッチコピー）');
    expect(prompt).toContain('2. 「8/10〜8/23」（サブコピー）');
    expect(prompt).toContain('3. 「今すぐチェック」（訴求ポイント・特に目立たせる）');
  });

  it('強調カラーがあるときは、どの行をその色で目立たせるかまで言い切る', () => {
    const prompt = buildBannerPrompt({
      mode: 'banner',
      preset,
      textLines: ['春の感謝祭', '8/10〜8/23', '今すぐチェック'],
      emphasisLines: [true, false, true],
      baseColor: null,
      mainColor: null,
      subColor: null,
      accentColor: '#FFD400',
      personOption: 'without',
      customPrompt: '',
      freePrompt: '',
    });
    expect(prompt).toContain('「春の感謝祭」・「今すぐチェック」 は、強調カラー #FFD400 を使って他の行よりはっきり目立たせてください。');
  });

  it('強調が無いときは今までどおり（行に印を付けない）', () => {
    const prompt = buildBannerPrompt({
      mode: 'banner',
      preset,
      textLines: ['春の感謝祭'],
      baseColor: null,
      mainColor: null,
      subColor: null,
      accentColor: '#FFD400',
      personOption: 'without',
      customPrompt: '',
      freePrompt: '',
    });
    expect(prompt).toContain('1. 「春の感謝祭」（メインのキャッチコピー）');
    expect(prompt).not.toContain('特に目立たせる');
    expect(prompt).not.toContain('そのうち');
  });

  it('空の行を落としても、強調が同じ行に付いてくる', () => {
    const result = validateBannerRequest({
      presetKey: 'line_rich_message',
      count: 1,
      textLines: ['  ', '送料無料', 'A'],
      emphasisLines: [true, true, false],
    });
    expect(result.ok).toBe(true);
    expect(result.value?.textLines).toEqual(['送料無料', 'A']);
    expect(result.value?.emphasisLines).toEqual([true, false]);
  });

  it('強調の指定が無い依頼でも通り、全部オフになる', () => {
    const result = validateBannerRequest({
      presetKey: 'line_rich_message',
      count: 1,
      textLines: ['送料無料'],
    });
    expect(result.ok).toBe(true);
    expect(result.value?.emphasisLines).toEqual([false]);
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

  it('色の4つの役割を受け取り、空文字とすけ具合つきも扱える（★BG-B KkTNS）', () => {
    const result = validateBannerRequest({
      presetKey: 'line_rich_message',
      count: 1,
      textLines: ['A'],
      baseColor: '#FFFFFF',
      mainColor: '#d7263d80',
      subColor: '',
      accentColor: undefined,
    });
    expect(result.ok).toBe(true);
    expect(result.value?.baseColor).toBe('#FFFFFF');
    expect(result.value?.mainColor).toBe('#d7263d80');
    expect(result.value?.subColor).toBeNull();
    expect(result.value?.accentColor).toBeNull();
  });

  it.each([
    [{ count: 1, textLines: ['A'] }, '用途'],
    [{ presetKey: 'line_rich_message', count: 9, textLines: ['A'] }, '枚数'],
    [{ presetKey: 'line_rich_message', count: 1, textLines: ['A'], baseColor: 'white' }, 'ベースカラー'],
    [{ presetKey: 'line_rich_message', count: 1, textLines: ['A'], mainColor: 'red' }, 'メインカラー'],
    [{ presetKey: 'line_rich_message', count: 1, textLines: ['A'], subColor: '#12345' }, 'サブカラー'],
    [{ presetKey: 'line_rich_message', count: 1, textLines: ['A'], accentColor: '#1234567' }, '強調カラー'],
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

describe('参照画像（35-2・★BG-C `cOgWE`）', () => {
  const preset = BANNER_PRESETS[0];
  const base = { mode: 'banner' as const, preset, textLines: ['秋の感謝祭'], baseColor: null, mainColor: null, subColor: null, accentColor: null, personOption: 'without' as const, customPrompt: '', freePrompt: '' };

  it('使い方ごとに先頭の言い方が変わる', () => {
    expect(buildBannerPrompt({ ...base, references: [{ imageId: 'i1', mode: 'edit' }] })).toMatch(/^添付した画像を土台にして描き直してください/);
    expect(buildBannerPrompt({ ...base, references: [{ imageId: 'i1', mode: 'inspire' }] })).toMatch(/^添付した画像は参考です/);
    expect(buildBannerPrompt({ ...base, references: [{ imageId: 'i1', mode: 'parts' }] })).toMatch(/^添付した画像から素材を一部だけ使ってください/);
    expect(buildBannerPrompt({ ...base, references: [] })).not.toContain('添付した画像');
    expect(buildBannerPrompt({ ...base, references: null })).not.toContain('添付した画像');
  });

  it('複数枚は「N枚目」で画像ごとの扱いを言い分ける（最大3枚）', () => {
    const prompt = buildBannerPrompt({
      ...base,
      references: [
        { imageId: 'i1', mode: 'edit' },
        { imageId: 'i2', mode: 'parts' },
        { imageId: 'i3', mode: 'inspire' },
      ],
    });
    expect(prompt).toContain('添付した画像は3枚あります');
    expect(prompt).toMatch(/1枚目: 土台にします/);
    expect(prompt).toMatch(/2枚目: 素材を一部だけ使います/);
    expect(prompt).toMatch(/3枚目: 雰囲気の参考にします/);
    // 4枚目以降は切り捨てる。
    const over = buildBannerPrompt({
      ...base,
      references: [
        { imageId: 'i1', mode: 'edit' },
        { imageId: 'i2', mode: 'edit' },
        { imageId: 'i3', mode: 'edit' },
        { imageId: 'i4', mode: 'edit' },
      ],
    });
    expect(over).toContain('添付した画像は3枚あります');
    expect(over).not.toContain('4枚目');
  });

  it('参照画像があるときは使い方が必須。土台にするなら文字も指示も無くてよい', () => {
    const body = { presetKey: preset.key, count: 1, textLines: [], personOption: 'without' };
    expect(validateBannerRequest({ ...body, references: [{ imageId: 'img-1' }] }).error).toContain('使い方');
    expect(validateBannerRequest({ ...body, references: [{ imageId: 'img-1', mode: 'edit' }] }).ok).toBe(true);
    expect(validateBannerRequest({ ...body, references: [{ imageId: 'img-1', mode: 'parts' }] }).error).toContain('テキストか');
    expect(validateBannerRequest({ ...body, references: [{ imageId: 'img-1', mode: 'inspire' }] }).error).toContain('テキストか');
    expect(validateBannerRequest({ ...body, references: [{ imageId: 42, mode: 'edit' }] }).error).toContain('参照画像');
    const ok = validateBannerRequest({
      ...body,
      textLines: ['a'],
      references: [
        { imageId: ' img-2 ', mode: 'inspire' },
        { imageId: 'img-3', mode: 'parts' },
      ],
    });
    expect(ok.value?.references).toEqual([
      { imageId: 'img-2', mode: 'inspire' },
      { imageId: 'img-3', mode: 'parts' },
    ]);
    expect(validateBannerRequest({ ...body, textLines: ['a'] }).value?.references).toEqual([]);
  });

  it('4枚以上と同じ画像の重複は分かる言葉で断る', () => {
    const body = { presetKey: preset.key, count: 1, textLines: ['a'], personOption: 'without' };
    expect(
      validateBannerRequest({
        ...body,
        references: [
          { imageId: 'i1', mode: 'edit' },
          { imageId: 'i2', mode: 'edit' },
          { imageId: 'i3', mode: 'edit' },
          { imageId: 'i4', mode: 'edit' },
        ],
      }).error,
    ).toContain('3枚まで');
    expect(
      validateBannerRequest({
        ...body,
        references: [
          { imageId: 'i1', mode: 'edit' },
          { imageId: 'i1', mode: 'inspire' },
        ],
      }).error,
    ).toContain('同じ画像');
  });

  it('前の版が送る1枚組（referenceImageId）も受ける', () => {
    const body = { presetKey: preset.key, count: 1, textLines: ['a'], personOption: 'without' };
    const ok = validateBannerRequest({ ...body, referenceImageId: 'img-9', referenceMode: 'edit' });
    expect(ok.value?.references).toEqual([{ imageId: 'img-9', mode: 'edit' }]);
    expect(validateBannerRequest({ ...body, referenceImageId: 'img-9' }).error).toContain('使い方');
  });
});
