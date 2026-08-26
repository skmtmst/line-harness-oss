import { describe, expect, it, vi } from 'vitest';
import { createTagsBulk } from '../src/tags.js';

type PreparedCall = {
  sql: string;
  binds: unknown[];
};

function mockD1(options: { failStatement?: number; skipRow?: number } = {}) {
  const calls: PreparedCall[] = [];
  let statementIndex = 0;
  const db = {
    prepare: vi.fn((sql: string) => {
      const call: PreparedCall = { sql, binds: [] };
      calls.push(call);
      return {
        bind: (...binds: unknown[]) => {
          call.binds = binds;
          const currentStatement = statementIndex++;
          return {
            run: async () => {
              if (currentStatement === options.failStatement) {
                throw new Error('D1 unavailable');
              }
              const ids = binds.filter((_value, index) => index % 4 === 0) as string[];
              const results = ids
                .filter((_id, index) => currentStatement * 25 + index !== options.skipRow)
                .map((id) => ({ id }));
              return { success: true, results, meta: {} };
            },
          };
        },
      };
    }),
  } as unknown as D1Database;
  return { db, calls };
}

describe('createTagsBulk', () => {
  it('500件を20クエリ・各100バインド以内で登録する', async () => {
    const { db, calls } = mockD1();
    const inputs = Array.from({ length: 500 }, (_, index) => ({
      name: `タグ${index}`,
      groupId: index % 2 === 0 ? 'folder-1' : null,
    }));

    const result = await createTagsBulk(db, inputs);

    expect(calls).toHaveLength(20);
    expect(calls.every((call) => call.binds.length === 100)).toBe(true);
    expect(calls.every((call) => call.sql.includes('INSERT OR IGNORE'))).toBe(true);
    expect(calls.every((call) => call.sql.includes('RETURNING id'))).toBe(true);
    expect(result).toHaveLength(500);
    expect(result.every((row) => row.status === 'created' && row.tagId)).toBe(true);
  });

  it('同名競合でRETURNINGされなかった行だけを見送りにする', async () => {
    const { db } = mockD1({ skipRow: 1 });
    const result = await createTagsBulk(db, [
      { name: 'A' },
      { name: 'B' },
      { name: 'C' },
    ]);

    expect(result.map((row) => row.status)).toEqual(['created', 'skipped', 'created']);
  });

  it('1文が失敗しても次の25件は続ける', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { db } = mockD1({ failStatement: 0 });
    const result = await createTagsBulk(
      db,
      Array.from({ length: 26 }, (_, index) => ({ name: `タグ${index}` })),
    );

    expect(result.slice(0, 25).every((row) => row.status === 'failed')).toBe(true);
    expect(result[25].status).toBe('created');
    consoleError.mockRestore();
  });
});
