import { describe, it, expect } from 'vitest';
import {
  buildTapPostbackData,
  parseTapPostbackData,
  currentMonthRange,
} from './rich-menu-tap.js';

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

describe('集計の既定期間', () => {
  it('月の途中なら、その月の1日から翌月1日まで', () => {
    expect(currentMonthRange('2026-08-19T22:30:00.000')).toEqual({
      from: '2026-08-01T00:00:00.000',
      to: '2026-09-01T00:00:00.000',
    });
  });

  it('12月は年をまたぐ', () => {
    expect(currentMonthRange('2026-12-31T23:59:59.999')).toEqual({
      from: '2026-12-01T00:00:00.000',
      to: '2027-01-01T00:00:00.000',
    });
  });

  it('1桁の月は 0 を詰める（詰めないと文字列の大小が狂う）', () => {
    const { from, to } = currentMonthRange('2026-09-15T12:00:00.000');
    expect(from).toBe('2026-09-01T00:00:00.000');
    expect(to).toBe('2026-10-01T00:00:00.000');
    expect('2026-09-30T23:59:59.999' >= from).toBe(true);
    expect('2026-09-30T23:59:59.999' < to).toBe(true);
    // 前月の記録は入らない
    expect('2026-08-31T23:59:59.999' >= from).toBe(false);
  });

  it('月初 0:00 ちょうども、その月に入る', () => {
    const { from } = currentMonthRange('2026-08-01T00:00:00.000');
    expect('2026-08-01T00:00:00.000' >= from).toBe(true);
  });
});
