import { describe, expect, it } from 'vitest';
import {
  ListPagingError,
  buildCursorListResponse,
  buildOffsetListResponse,
  offsetPageCount,
  parseCursorPaging,
  parseOffsetPaging,
  listQueryNumber,
  listLimit,
  boundedListInteger,
  clampedListInteger,
  listIntegerInRange,
  truncatedListLimit,
} from './list-paging.js';

const SORT = [
  { field: 'createdAt', direction: 'desc' as const },
  { field: 'id', direction: 'desc' as const },
];

describe('共通一覧の入力', () => {
  it.each([
    [undefined, 20, 20, 20, 20, 20],
    ['', 20, 0, 1, 20, 1],
    ['-1', 20, 20, 1, null, 1],
    ['0', 20, 0, 1, null, 1],
    ['1.5', 20, 20, 20, null, 1],
    ['201', 200, 200, 200, null, 200],
    ['abc', 20, 20, 20, null, 20],
  ] as const)('指定%sの入口ごとの拒否・既定値・切り捨てを保つ', (raw, positive, bounded, clamped, ranged, truncated) => {
    expect(listLimit(raw, 20)).toBe(positive);
    expect(boundedListInteger(raw, 20, 200)).toBe(bounded);
    expect(clampedListInteger(raw, 20, 1, 200)).toBe(clamped);
    expect(listIntegerInRange(raw, 20, 1, 200)).toBe(ranged);
    expect(truncatedListLimit(raw, 20, 200)).toBe(truncated);
  });
  it('入口が丸めと入力エラーを判定するために既定値・0・小数を区別して渡す', () => {
    expect(listQueryNumber(undefined, 20)).toBe(20);
    expect(listQueryNumber('', 20)).toBe(0);
    expect(listQueryNumber('0', 20)).toBe(0);
    expect(listQueryNumber('1.5', 20)).toBe(1.5);
    expect(listQueryNumber('abc', 20)).toBeNaN();
  });

  it('先頭の整数を受け付ける入口の指定を保つ', () => {
    expect(listQueryNumber('20rows', 50, { format: 'integer-prefix' })).toBe(20);
    expect(listQueryNumber('1.5', 50, { format: 'integer-prefix' })).toBe(1);
    expect(listQueryNumber(undefined, 50, { format: 'integer-prefix' })).toBe(50);
    expect(listQueryNumber(undefined, '', { format: 'integer-prefix' })).toBeNaN();
    expect(listQueryNumber('abc', 50, { format: 'integer-prefix' })).toBeNaN();
  });
  it('上限を超えた limit は200へ丸める', () => {
    expect(parseOffsetPaging({ page: '3', limit: '999' })).toEqual({
      page: 3,
      limit: 200,
      offset: 400,
    });
    expect(parseCursorPaging({ limit: '999' })).toEqual({ limit: 200 });
  });

  it('既存 route は既定値と上限を指定して保てる', () => {
    expect(parseOffsetPaging({}, { defaultLimit: 25, maxLimit: 100 })).toEqual({
      page: 1,
      limit: 25,
      offset: 0,
    });
  });

  it('offset は途中の行位置を丸めずに保ち、page と併記したときは offset を使う', () => {
    expect(parseOffsetPaging({ offset: '15', page: '9', limit: '10' })).toEqual({
      page: 2, limit: 10, offset: 15,
    });
  });

  it.each(['-1', '1.5', 'Infinity', 'abc', '9007199254740992'])(
    '不正な offset=%s は先頭へ戻す', (offset) => {
      expect(parseOffsetPaging({ offset, limit: '20' })).toEqual({ page: 1, limit: 20, offset: 0 });
    },
  );

  it('上限が大きい一覧も指定した件数と開始位置を保つ', () => {
    expect(parseOffsetPaging({ offset: '500', limit: '999' }, { defaultLimit: 100, maxLimit: 500 }))
      .toEqual({ page: 2, limit: 500, offset: 500 });
  });

  it('壊れた cursor は route が400へ変換できる共通エラーにする', () => {
    expect(() => parseCursorPaging({ cursor: 'not a cursor' })).toThrowError(ListPagingError);
    try {
      parseCursorPaging({ cursor: 'not a cursor' });
    } catch (error) {
      expect(error).toMatchObject({ status: 400, code: 'cursor_invalid', field: 'cursor' });
    }
  });
});

describe('共通一覧の応答', () => {
  it('offset は適用した limit・total・固定 sort を返す', () => {
    const paging = parseOffsetPaging({ page: '2', limit: '2' });
    expect(buildOffsetListResponse({ items: ['c', 'd'], total: 4, paging, sort: SORT })).toEqual({
      items: ['c', 'd'], total: 4, limit: 2, sort: SORT,
    });
  });

  it('cursor は続きがあるときだけ nextCursor を返す', () => {
    const paging = parseCursorPaging({ limit: '2' });
    expect(buildCursorListResponse({ items: ['a', 'b'], nextCursor: 'opaque_2', paging, sort: SORT }))
      .toEqual({ items: ['a', 'b'], nextCursor: 'opaque_2', limit: 2, sort: SORT });
    expect(buildCursorListResponse({ items: [], paging, sort: SORT }))
      .toEqual({ items: [], limit: 2, sort: SORT });
  });

  it('0件でも pageCount は1になる', () => {
    expect(offsetPageCount(0, 50)).toBe(1);
  });
});
