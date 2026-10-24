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

  it.each([
    [undefined, undefined, 100, 0], ['', '', 100, 0], ['0', '-1', 100, 0],
    ['-2', '15rows', 1, 15], ['1.5', '2.5', 1, 2], ['999', '500', 200, 500],
    ['abc', 'abc', 100, 0],
  ])('先頭整数を許す一覧の件数%s・開始位置%sを保つ', (limit, offset, expectedLimit, expectedOffset) => {
    const paging = parseOffsetPaging({ limit, offset }, {
      defaultLimit: 100,
      limitPolicy: { format: 'integer-prefix', fallback: 'falsy', minimum: 1, maximum: 200 },
      offsetPolicy: { format: 'integer-prefix', fallback: 'falsy', minimum: 0 },
    });
    expect(paging.limit).toBe(expectedLimit);
    expect(paging.offset).toBe(expectedOffset);
  });

  it('拒否する入口へは0・小数・不正値を丸めずに返す', () => {
    const options = { defaultLimit: 20, limitPolicy: {}, offsetPolicy: {} };
    expect(parseOffsetPaging({ limit: '0', offset: '-1' }, options)).toMatchObject({ limit: 0, offset: -1 });
    expect(parseOffsetPaging({ limit: '1.5', offset: '2.5' }, options)).toMatchObject({ limit: 1.5, offset: 2.5 });
    expect(parseOffsetPaging({ limit: 'abc' }, options).limit).toBeNaN();
    expect(parseOffsetPaging({ offset: 'abc' }, options).offset).toBeNaN();
    expect(parseOffsetPaging({ limit: '500' }, options).limit).toBe(500);
    expect(parseOffsetPaging({ limit: '' }, options).limit).toBe(0);
  });

  it.each([
    [undefined, 20, 20, 20], ['', 1, 1, 1], ['0', 1, 1, 1],
    ['-1', 1, 20, 1], ['1.5', 20, 20, 1], ['201', 100, 100, 100],
    ['abc', 20, 20, 20], ['Infinity', 20, 20, 20],
  ])('整数の検査・負数を既定へ戻す・切り捨ての違いを%sで保つ', (raw, integer, nonnegative, truncated) => {
    const parse = (limitPolicy: NonNullable<Parameters<typeof parseOffsetPaging>[1]>['limitPolicy']) =>
      parseOffsetPaging({ limit: raw }, { defaultLimit: 20, limitPolicy }).limit;
    expect(parse({ fallback: 'integer', minimum: 1, maximum: 100 })).toBe(integer);
    expect(parse({ fallback: 'nonnegative-integer', minimum: 1, maximum: 100 })).toBe(nonnegative);
    expect(parse({ fallback: 'finite', truncate: true, minimum: 1, maximum: 100 })).toBe(truncated);
  });

  it('pageSizeの別名を受け取る入口も既定値と先頭整数の扱いを保つ', () => {
    const paging = parseOffsetPaging({ page: '3pages', limit: '25rows' }, {
      defaultLimit: 20,
      pagePolicy: { format: 'integer-prefix', fallback: 'falsy', minimum: 1 },
      limitPolicy: { format: 'integer-prefix', fallback: 'falsy', minimum: 1, maximum: 100 },
    });
    expect(paging).toEqual({ page: 3, limit: 25, offset: 50 });
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
  it('旧画面が読む別名・集計・ページ位置を残し、全体件数とページ内件数を分ける', () => {
    const items = [{ id: 'second-page' }];
    const response = buildOffsetListResponse({
      items, requests: items, total: 21, paging: { limit: 20 }, sort: SORT,
      pagination: { total: 21, limit: 20, offset: 20 }, summary: { active: 7 },
    });
    expect(response).toEqual({
      items, requests: items, total: 21, limit: 20, sort: SORT,
      pagination: { total: 21, limit: 20, offset: 20 }, summary: { active: 7 },
    });
    expect(response.requests).toBe(response.items);
    expect(response).not.toHaveProperty('paging');
  });

  it('総件数が不明な履歴は捏造せず、空の続き位置と旧項目を保つ', () => {
    const response = buildCursorListResponse({
      items: ['last'], nextCursor: null, nextOffset: null,
      paging: { limit: 20 }, sort: SORT, summary: { failed: 2 },
    });
    expect(response).toEqual({
      items: ['last'], nextCursor: null, nextOffset: null,
      limit: 20, sort: SORT, summary: { failed: 2 },
    });
    expect(response).not.toHaveProperty('total');
    expect(response).not.toHaveProperty('paging');
  });

  it('日時とIDの組で渡す既存の続き位置も、値と型を保つ', () => {
    const nextCursor = { beforeAt: '2026-10-23T00:00:00Z', beforeId: 'last' };
    const response = buildCursorListResponse({ items: ['last'], nextCursor, paging: { limit: 20 }, sort: SORT });
    expect(response.nextCursor).toEqual(nextCursor);
    expect(response.nextCursor?.beforeId).toBe('last');
    expect(response).not.toHaveProperty('total');
  });

  it('offset は適用した limit・total・固定 sort を返す', () => {
    const paging = parseOffsetPaging({ page: '2', limit: '2' });
    expect(buildOffsetListResponse({ items: ['c', 'd'], total: 4, paging, sort: SORT })).toEqual({
      items: ['c', 'd'], total: 4, limit: 2, offset: 2, sort: SORT,
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
