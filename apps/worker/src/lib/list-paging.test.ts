import { describe, expect, it } from 'vitest';
import {
  ListPagingError,
  buildCursorListResponse,
  buildOffsetListResponse,
  offsetPageCount,
  parseCursorPaging,
  parseOffsetPaging,
} from './list-paging.js';

const SORT = [
  { field: 'createdAt', direction: 'desc' as const },
  { field: 'id', direction: 'desc' as const },
];

describe('共通一覧の入力', () => {
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
