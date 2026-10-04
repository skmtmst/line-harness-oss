import { describe, expect, it } from 'vitest';
import {
  contrastWithWhite,
  DEFAULT_LOOK,
  lookStyleVars,
  normalizeHex,
  resolveLook,
  soften,
  textOnColor,
} from './liff-look.js';

/**
 * LIFF の見た目の型の土台 (M2)。設定の読み倒しと見やすさの計算。
 * 絵の指定値：⑤の主 #03873a は白字との比 4.64 (14-liff.md)。
 */

describe('resolveLook', () => {
  it('何も来なければ今の見た目 (⑤・週を先に・点あり)', () => {
    expect(resolveLook(null)).toEqual(DEFAULT_LOOK);
    expect(resolveLook({})).toEqual({
      theme: 'line',
      primaryColor: null,
      backgroundColor: null,
      headingFont: 'default',
      calendarMode: 'week-first',
      vacancyDots: true,
    });
  });

  it('5つの型だけ受け、変な型は⑤に戻す', () => {
    for (const theme of ['natural', 'modern', 'gentle', 'night', 'line']) {
      expect(resolveLook({ liff_theme: theme }).theme).toBe(theme);
    }
    expect(resolveLook({ liff_theme: 'midnight' }).theme).toBe('line');
  });

  it('店の色は #rrggbb だけ受け、変な値は捨てる', () => {
    expect(resolveLook({ shop_primary_color: '#123D2F' }).primaryColor).toBe('#123d2f');
    expect(resolveLook({ shop_primary_color: '#abc' }).primaryColor).toBe('#aabbcc');
    expect(resolveLook({ shop_primary_color: 'red' }).primaryColor).toBeNull();
    expect(resolveLook({ shop_primary_color: '#12345' }).primaryColor).toBeNull();
    expect(resolveLook({ shop_background_color: '#0F1C33' }).backgroundColor).toBe('#0f1c33');
  });

  it('カレンダーの出し方は4択。旧い欄は出し方が無いときだけ使う', () => {
    for (const mode of ['week-first', 'month-first', 'week-only', 'month-only']) {
      expect(resolveLook({ liff_calendar_mode: mode }).calendarMode).toBe(mode);
    }
    expect(resolveLook({ liff_date_view: 'calendar' }).calendarMode).toBe('month-first');
    expect(resolveLook({ liff_date_view: 'list' }).calendarMode).toBe('week-first');
    // 新しい欄が勝つ。
    expect(
      resolveLook({ liff_calendar_mode: 'week-only', liff_date_view: 'calendar' }).calendarMode,
    ).toBe('week-only');
    expect(resolveLook({ liff_calendar_mode: 'both' }).calendarMode).toBe('week-first');
  });

  it('空きの点は来なければ付ける。0・false だけ消す', () => {
    expect(resolveLook({}).vacancyDots).toBe(true);
    expect(resolveLook({ liff_vacancy_dots: 1 }).vacancyDots).toBe(true);
    expect(resolveLook({ liff_vacancy_dots: 0 }).vacancyDots).toBe(false);
    expect(resolveLook({ liff_vacancy_dots: false }).vacancyDots).toBe(false);
    expect(resolveLook({ liff_vacancy_dots: '0' }).vacancyDots).toBe(false);
  });
});

describe('normalizeHex', () => {
  it('#rgb を #rrggbb に広げ、小文字にする', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('  #03873A ')).toBe('#03873a');
    expect(normalizeHex('#03873a')).toBe('#03873a');
    expect(normalizeHex('03873a')).toBeNull();
    expect(normalizeHex('#ffff')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('見やすさの計算 (白字との比 4.5 以上)', () => {
  it('⑤の主 #03873a は白字が読める (絵の指定 4.64)', () => {
    const ratio = contrastWithWhite('#03873a');
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
    expect(ratio!).toBeCloseTo(4.64, 1);
    expect(textOnColor('#03873a')).toBe('#ffffff');
  });

  it('④夜の字 #f2f5fa と地 #0f1c33 は十分読める', () => {
    const ratio = contrastWithWhite('#0f1c33');
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it('薄い店の色では字を濃くする', () => {
    expect(contrastWithWhite('#f7f2e4')!).toBeLessThan(4.5);
    expect(textOnColor('#f7f2e4')).toBe('#1d1d1f');
    expect(textOnColor('#ffffff')).toBe('#1d1d1f');
    expect(textOnColor('#000000')).toBe('#ffffff');
  });

  it('変な色が来ても白のまま (今どおり・止めない)', () => {
    expect(contrastWithWhite('red')).toBeNull();
    expect(textOnColor('red')).toBe('#ffffff');
  });
});

describe('soften', () => {
  it('主の色を白に寄せた薄い地を作る', () => {
    expect(soften('#03873a', 0.5)).toBe('#81c39d');
    expect(soften('#000000', 1)).toBe('#ffffff');
    expect(soften('red')).toBeNull();
  });
});

describe('lookStyleVars', () => {
  it('店の色が無ければ何も重ねない (型の色のまま)', () => {
    expect(lookStyleVars(DEFAULT_LOOK)).toEqual({});
  });

  it('店の色は型の上に重ね、字の色まで決める', () => {
    const vars = lookStyleVars({
      ...DEFAULT_LOOK,
      theme: 'night',
      primaryColor: '#123d2f',
    });
    expect(vars['--color-liff-primary']).toBe('#123d2f');
    expect(vars['--color-liff-soft']).toBe(soften('#123d2f'));
    // 濃い緑の上は白字が読める。
    expect(vars['--liff-on-primary']).toBe('#ffffff');
  });

  it('薄い店の色ではボタンの字を濃くする', () => {
    const vars = lookStyleVars({ ...DEFAULT_LOOK, primaryColor: '#f7f2e4' });
    expect(vars['--liff-on-primary']).toBe('#1d1d1f');
  });

  it('見出しの書体だけ替えるときはその1変数だけ', () => {
    const vars = lookStyleVars({ ...DEFAULT_LOOK, headingFont: 'marugothic' });
    expect(vars).toEqual({
      '--liff-font-heading': expect.stringContaining('Zen Maru Gothic'),
    });
  });
});
