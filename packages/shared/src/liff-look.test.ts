import { describe, expect, test } from 'vitest';

import {
  checkLiffColor,
  LIFF_NIGHT_COLORS,
  liffContrastRatio,
  normalizeLiffCalendarMode,
  normalizeLiffFormAppearance,
  normalizeLiffHeadingFont,
  normalizeLiffStoreAppearance,
  normalizeLiffTheme,
  resolveLiffTextColor,
} from './liff-look';

describe('LIFF の見た目の型', () => {
  test('型を選んでいない店は「line」（今の見た目のまま）', () => {
    expect(normalizeLiffTheme(undefined)).toBe('line');
    expect(normalizeLiffTheme('unknown')).toBe('line');
    expect(normalizeLiffTheme('night')).toBe('night');
  });

  test('カレンダーの出し方の既定は週を先に', () => {
    expect(normalizeLiffCalendarMode(undefined)).toBe('week_first');
    expect(normalizeLiffCalendarMode('month_only')).toBe('month_only');
    expect(normalizeLiffCalendarMode('grid')).toBe('week_first');
  });

  test('見出しの書体の既定は型に従う', () => {
    expect(normalizeLiffHeadingFont(undefined)).toBe('default');
    expect(normalizeLiffHeadingFont('maru')).toBe('maru');
  });

  test('店の見た目の既定（型は LINE らしい・空きの点はオン）', () => {
    expect(normalizeLiffStoreAppearance(undefined)).toEqual({
      theme: 'line',
      primaryColor: null,
      backgroundColor: null,
      headingFont: 'default',
      calendarMode: 'week_first',
      vacancyDots: true,
    });
  });

  test('フォームの既定は店の設定に合わせる', () => {
    expect(normalizeLiffFormAppearance(undefined).mode).toBe('inherit');
    expect(normalizeLiffFormAppearance({ mode: 'custom', theme: 'night' })).toEqual({
      mode: 'custom',
      theme: 'night',
      primaryColor: null,
      backgroundColor: null,
      headingFont: 'default',
    });
  });

  test('④夜は深い紺（黒は使わない）', () => {
    expect(LIFF_NIGHT_COLORS.ground).toBe('#0f1c33');
    expect(LIFF_NIGHT_COLORS.surface).toBe('#172a47');
    expect(LIFF_NIGHT_COLORS.text).toBe('#f2f5fa');
    expect(LIFF_NIGHT_COLORS.ground).not.toBe('#000000');
  });

  test('白と黒の比は 21:1', () => {
    expect(liffContrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
  });

  test('深い紺の地には白い字', () => {
    expect(resolveLiffTextColor(LIFF_NIGHT_COLORS.ground)).toBe('#ffffff');
  });

  test('薄い地には黒い字にして保存は止めない', () => {
    const checked = checkLiffColor('#f5f5f7', '地の色');
    expect(checked.whiteOk).toBe(false);
    expect(checked.textColor).toBe('#1d1d1f');
    expect(checked.warnings.length).toBeGreaterThan(0);
  });

  test('型の色（null）は確かめようが無いので注意なし', () => {
    expect(checkLiffColor(null, '主の色').warnings).toEqual([]);
  });
});
