import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = {
  recordMediaUsage: vi.fn(),
  pruneStaleMediaUsages: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { scanMediaUsage } = await import('./media-usage-scan.js');

/**
 * 走査のモック。
 *
 * media の一覧を返し、各テーブルの LIKE 検索には hits に入れたものを返す。
 * キーは 'テーブル名' で持つ。
 */
function makeDb(
  media: Array<{ id: string; r2_key: string }>,
  hits: Record<string, string[]> = {},
  broken: string[] = [],
) {
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            async all() {
              if (sql.includes('FROM media ')) return { results: media };
              const table = Object.keys(hits).find((t) => sql.includes(`FROM ${t} `));
              const brokenTable = broken.find((t) => sql.includes(`FROM ${t} `));
              if (brokenTable) throw new Error(`no such table: ${brokenTable}`);
              if (!table) return { results: [] };
              // どのメディアを探しているかは binds の中身で判断する。
              const key = String(binds[0] ?? '');
              const matched = media.find((m) => key.includes(m.r2_key));
              return {
                results: matched && hits[table] ? hits[table].map((id) => ({ ref_id: id })) : [],
              };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.pruneStaleMediaUsages.mockResolvedValue(0);
});

describe('使用箇所の走査', () => {
  it('本文にキーが含まれていれば記録する', async () => {
    const db = makeDb([{ id: 'md-1', r2_key: 'media/a.png' }], { templates: ['tpl-1', 'tpl-2'] });
    const result = await scanMediaUsage(db, '2026-08-16T00:00:00.000');
    expect(result.matched).toBe(2);
    expect(dbMocks.recordMediaUsage).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ mediaId: 'md-1', refKind: 'template', refId: 'tpl-1' }),
    );
  });

  it('リッチメニューは実在するページ表のR2キーを走査する', async () => {
    const db = makeDb(
      [{ id: 'md-1', r2_key: 'media/menu.png' }],
      { rich_menu_pages: ['page-1'] },
    );
    const result = await scanMediaUsage(db, '2026-08-16T00:00:00.000');
    expect(result.matched).toBe(1);
    expect(dbMocks.recordMediaUsage).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ mediaId: 'md-1', refKind: 'rich_menu', refId: 'page-1' }),
    );
  });

  it('どこにも無ければ記録しない', async () => {
    const db = makeDb([{ id: 'md-1', r2_key: 'media/a.png' }]);
    const result = await scanMediaUsage(db, '2026-08-16T00:00:00.000');
    expect(result.matched).toBe(0);
    expect(dbMocks.recordMediaUsage).not.toHaveBeenCalled();
  });

  it('走査したメディアだけを対象に、古い記録を消す', async () => {
    // 上限で外れたメディアの記録まで消すと、それらが
    // 「どこでも使われていない」ことになり、削除前の警告が効かなくなる。
    const db = makeDb([
      { id: 'md-1', r2_key: 'media/a.png' },
      { id: 'md-2', r2_key: 'media/b.png' },
    ]);
    await scanMediaUsage(db, '2026-08-16T00:00:00.000');
    expect(dbMocks.pruneStaleMediaUsages).toHaveBeenCalledWith(
      db,
      '2026-08-16T00:00:00.000',
      ['md-1', 'md-2'],
    );
  });

  it('表が無いテーブルは飛ばして続ける', async () => {
    // 機能を使っていない環境では表そのものが無い。1つ欠けたせいで
    // 走査全体が止まる方が困る。
    const db = makeDb(
      [{ id: 'md-1', r2_key: 'media/a.png' }],
      { templates: ['tpl-1'] },
      ['webinars'],
    );
    const result = await scanMediaUsage(db, '2026-08-16T00:00:00.000');
    expect(result.matched).toBe(1);
  });

  it('メディアが1件も無ければ何もしない', async () => {
    const db = makeDb([]);
    const result = await scanMediaUsage(db, '2026-08-16T00:00:00.000');
    expect(result).toMatchObject({ scanned: 0, matched: 0 });
    expect(dbMocks.pruneStaleMediaUsages).toHaveBeenCalledWith(
      db,
      '2026-08-16T00:00:00.000',
      [],
    );
  });
});
