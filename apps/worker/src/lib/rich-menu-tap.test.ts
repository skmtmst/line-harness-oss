import { describe, it, expect } from 'vitest';
import { buildTapPostbackData, parseTapPostbackData } from './rich-menu-tap.js';

describe('buildTapPostbackData', () => {
  it('付随する data が無ければ目印だけ', () => {
    expect(buildTapPostbackData('area-1')).toBe('rma=area-1');
  });

  it('元の data は URL エンコードして後ろに付ける', () => {
    expect(buildTapPostbackData('area-1', '予約する')).toBe(
      'rma=area-1&d=%E4%BA%88%E7%B4%84%E3%81%99%E3%82%8B',
    );
  });

  it('元の data に & や = が入っていても壊れない', () => {
    const inner = 'kind=coupon&id=3';
    const built = buildTapPostbackData('area-1', inner);
    expect(parseTapPostbackData(built)).toEqual({ areaId: 'area-1', inner });
  });
});

describe('parseTapPostbackData', () => {
  it('目印が無い data は素通しさせる（null を返す）', () => {
    expect(parseTapPostbackData('tag:premium')).toBeNull();
    expect(parseTapPostbackData('sq:step-1:0')).toBeNull();
    expect(parseTapPostbackData('')).toBeNull();
  });

  it('目印だけなら inner は null', () => {
    expect(parseTapPostbackData('rma=area-9')).toEqual({ areaId: 'area-9', inner: null });
  });

  it('組み立てた data を元に戻せる', () => {
    const built = buildTapPostbackData('3a7c2f1d-1111-2222-3333-444444444444', 'switch-to-p2');
    expect(parseTapPostbackData(built)).toEqual({
      areaId: '3a7c2f1d-1111-2222-3333-444444444444',
      inner: 'switch-to-p2',
    });
  });

  it('area id が空なら目印として扱わない', () => {
    expect(parseTapPostbackData('rma=')).toBeNull();
    expect(parseTapPostbackData('rma=&d=x')).toBeNull();
  });

  it('壊れたエンコードでも、押されたボタンの識別だけは残す', () => {
    const parsed = parseTapPostbackData('rma=area-1&d=%E0%A4%A');
    expect(parsed?.areaId).toBe('area-1');
    expect(parsed?.inner).toBe('%E0%A4%A');
  });
});
