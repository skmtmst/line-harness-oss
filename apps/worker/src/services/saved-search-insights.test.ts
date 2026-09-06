import { describe, expect, it, vi } from 'vitest';
import type { SavedSearch } from '@line-crm/db';
import {
  getSavedSearchMatchInsights,
  getSavedSearchMatchPreview,
} from './saved-search-insights.js';

function row(id: string, conditions: unknown): SavedSearch {
  return {
    id,
    name: id,
    scope: 'friends',
    condition_format: 'search_v1',
    conditions_json: typeof conditions === 'string' ? conditions : JSON.stringify(conditions),
    created_by: 'staff-1',
    line_account_id: 'account-1',
    is_shared: 1,
    display_order: 0,
    created_at: '2026-08-28T00:00:00.000',
  };
}

describe('保存した検索の該当人数', () => {
  it('友だち一覧と同じ条件を使い、実値0を0人として返す', async () => {
    const statement = { bind: vi.fn() } as unknown as D1PreparedStatement;
    (statement.bind as unknown as ReturnType<typeof vi.fn>).mockReturnValue(statement);
    const db = {
      prepare: vi.fn(() => statement),
      batch: vi.fn(async () => [{ success: true, results: [{ total: 0 }] }]),
    } as unknown as D1Database;

    const result = await getSavedSearchMatchInsights(db, [row('search-1', {
      all: [{ kind: 'tag', op: 'includes', value: 'tag-vip' }],
    })], 'account-1');

    expect(result.get('search-1')).toEqual({ matchCount: 0, matchCountError: null });
    expect(statement.bind).toHaveBeenCalledWith('account-1', 'tag-vip');
  });

  it('使えない比較方法を0人にせず理由付きの未取得にする', async () => {
    const db = { prepare: vi.fn(), batch: vi.fn() } as unknown as D1Database;
    const result = await getSavedSearchMatchInsights(db, [
      row('broken-json', '{'),
      row('unsupported', { all: [{ kind: 'form', op: 'answered', formId: 'form-1' }] }),
    ], 'account-1');

    expect(result.get('broken-json')).toEqual({
      matchCount: null,
      matchCountError: '条件のJSONが壊れています',
    });
    expect(result.get('unsupported')?.matchCount).toBeNull();
    expect(result.get('unsupported')?.matchCountError).toContain('使えない比較方法');
    expect(db.batch).not.toHaveBeenCalled();
  });

  it('集計口の一時失敗を作成・編集の失敗にせず未取得として返す', async () => {
    const statement = { bind: vi.fn() } as unknown as D1PreparedStatement;
    (statement.bind as unknown as ReturnType<typeof vi.fn>).mockReturnValue(statement);
    const db = {
      prepare: vi.fn(() => statement),
      batch: vi.fn(async () => { throw new Error('temporary D1 failure'); }),
    } as unknown as D1Database;

    const result = await getSavedSearchMatchInsights(db, [row('search-1', {
      all: [{ kind: 'tag', op: 'includes', value: 'tag-vip' }],
    })], 'account-1');

    expect(result.get('search-1')).toEqual({
      matchCount: null,
      matchCountError: '該当人数を確認できませんでした',
    });
  });
});

describe('保存した検索の該当プレビュー', () => {
  it('合計とLINE・メールの内訳を同じ条件SQLで返す', async () => {
    const statement = {
      bind: vi.fn(),
      first: vi.fn(async () => ({ total: 18, line_total: 15, mail_total: 3 })),
    } as unknown as D1PreparedStatement;
    (statement.bind as unknown as ReturnType<typeof vi.fn>).mockReturnValue(statement);
    const db = { prepare: vi.fn(() => statement) } as unknown as D1Database;

    const result = await getSavedSearchMatchPreview(db, {
      all: [{ kind: 'tag', op: 'includes', value: 'tag-vip' }],
    }, 'account-1');

    expect(result).toMatchObject({
      total: 18,
      byChannel: { line: 15, mail: 3 },
      error: null,
    });
    expect(statement.bind).toHaveBeenCalledWith('account-1', 'tag-vip');
  });

  it('集計失敗を0人にせず理由付きnullで返す', async () => {
    const statement = {
      bind: vi.fn(),
      first: vi.fn(async () => { throw new Error('D1 unavailable'); }),
    } as unknown as D1PreparedStatement;
    (statement.bind as unknown as ReturnType<typeof vi.fn>).mockReturnValue(statement);
    const db = { prepare: vi.fn(() => statement) } as unknown as D1Database;

    const result = await getSavedSearchMatchPreview(db, {
      all: [{ kind: 'name', op: 'contains', value: 'VIP' }],
    }, 'account-1');

    expect(result).toMatchObject({
      total: null,
      byChannel: { line: null, mail: null },
      error: '該当人数を確認できませんでした',
    });
  });
});
