import { beforeEach, describe, expect, test } from 'vitest';
import { _resetCacheForTest, computeDuplicatesStats } from './duplicates-stats.js';

type StubResult<T> = { results: T[] };

function stubDB(canned: {
  totals: { total_following: number; duplicate_groups: number; friend_dups: number };
  perAccount: Array<{ account_id: string; account_name: string; friends: number; dups: number }>;
  pairwiseRaw: Array<{ ident_key: string; line_account_id: string }>;
}) {
  return {
    prepare(sql: string) {
      // The pairwise raw-row query is the only one that filters via `dup_keys`;
      // route the stub by spotting that fingerprint. Everything else with
      // `.all()` is the per-account breakdown.
      const isPairwise = sql.includes('dup_keys');
      return {
        first: async () => canned.totals,
        all: async (): Promise<StubResult<unknown>> => ({
          results: isPairwise ? canned.pairwiseRaw : canned.perAccount,
        }),
        bind() {
          return this;
        },
      };
    },
  } as unknown as D1Database;
}

describe('computeDuplicatesStats', () => {
  beforeEach(() => {
    _resetCacheForTest();
  });

  test('returns a payload whose unique + dups equals total', async () => {
    const db = stubDB({
      totals: { total_following: 100, duplicate_groups: 10, friend_dups: 25 },
      perAccount: [
        { account_id: 'a1', account_name: 'L ①', friends: 60, dups: 20 },
        { account_id: 'a2', account_name: 'L ②', friends: 40, dups: 10 },
      ],
      // Two duplicate groups, each spanning a1 + a2 → 2 overlap pairs each direction.
      pairwiseRaw: [
        { ident_key: 'k1', line_account_id: 'a1' },
        { ident_key: 'k1', line_account_id: 'a2' },
        { ident_key: 'k2', line_account_id: 'a1' },
        { ident_key: 'k2', line_account_id: 'a2' },
      ],
    });

    const stats = await computeDuplicatesStats(db);

    expect(stats.total_following).toBe(100);
    expect(stats.duplicate_groups).toBe(10);
    expect(stats.friend_dups).toBe(25);
    expect(stats.unique_people).toBe(75);
    expect(stats.unique_people + stats.friend_dups).toBe(stats.total_following);
    expect(stats.msg_unit_yen).toBe(3);
    expect(stats.wasted_per_broadcast_yen).toBe(75); // 25 * 3
    expect(stats.per_account).toHaveLength(2);
    expect(stats.per_account[0]).toMatchObject({
      account_id: 'a1',
      account_name: 'L ①',
      friends: 60,
      dups: 20,
    });
    // 2 directed pairs (a1→a2 and a2→a1), each with overlap=2 (k1 and k2).
    expect(stats.pairwise_overlap).toHaveLength(2);
    const a1ToA2 = stats.pairwise_overlap.find(
      (p) => p.from_account_id === 'a1' && p.to_account_id === 'a2',
    );
    expect(a1ToA2?.overlap).toBe(2);
    const a2ToA1 = stats.pairwise_overlap.find(
      (p) => p.from_account_id === 'a2' && p.to_account_id === 'a1',
    );
    expect(a2ToA1?.overlap).toBe(2);
    expect(typeof stats.computed_at).toBe('string');
    expect(() => new Date(stats.computed_at)).not.toThrow();
  });

  test('accountIds で可視アカウントだけに絞る (#496-14)', async () => {
    const seen: Array<{ sql: string; binds: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const entry = { sql, binds: [] as unknown[] };
        seen.push(entry);
        const isPairwise = sql.includes('dup_keys');
        return {
          first: async () => ({ total_following: 10, duplicate_groups: 1, friend_dups: 2 }),
          all: async () => ({ results: isPairwise ? [] : [] }),
          bind(...binds: unknown[]) {
            entry.binds = binds;
            return this;
          },
        };
      },
    } as unknown as D1Database;

    await computeDuplicatesStats(db, { accountIds: ['account-a'] });

    // 3本の問い合わせすべてに絞りが入る。
    expect(seen).toHaveLength(3);
    for (const query of seen) {
      expect(query.sql).toContain('IN (?)');
      expect(query.sql).not.toContain('1 = 0');
    }
    // TOTALS と perAccount は絞りを2か所に持つ。
    expect(seen[0].binds).toEqual(['account-a', 'account-a']);
    expect(seen[1].binds).toEqual(['account-a', 'account-a']);
    expect(seen[2].binds).toEqual(['account-a']);
  });

  test('accountIds 未指定は従来どおり絞り無し、空配列は0件の集計', async () => {
    const seen: string[] = [];
    const db = {
      prepare(sql: string) {
        seen.push(sql);
        const isPairwise = sql.includes('dup_keys');
        return {
          first: async () => ({ total_following: 10, duplicate_groups: 0, friend_dups: 0 }),
          all: async () => ({ results: isPairwise ? [] : [] }),
          bind() {
            return this;
          },
        };
      },
    } as unknown as D1Database;

    await computeDuplicatesStats(db);
    expect(seen.join('\n')).not.toContain('IN (?)');

    seen.length = 0;
    await computeDuplicatesStats(db, { accountIds: [], forceRefresh: true });
    expect(seen.join('\n')).toContain('1 = 0');
  });

  test('キャッシュは範囲ごとに分ける', async () => {
    let callCount = 0;
    const db = {
      prepare(sql: string) {
        const isPairwise = sql.includes('dup_keys');
        return {
          first: async () => {
            callCount++;
            return { total_following: 10, duplicate_groups: 0, friend_dups: 0 };
          },
          all: async () => ({ results: isPairwise ? [] : [] }),
          bind() {
            return this;
          },
        };
      },
    } as unknown as D1Database;

    await computeDuplicatesStats(db, { accountIds: ['account-a'] });
    const afterFirst = callCount;
    // 同じ範囲はキャッシュが効く。
    await computeDuplicatesStats(db, { accountIds: ['account-a'] });
    expect(callCount).toBe(afterFirst);
    // 違う範囲は計算し直す（別アカウントの計数を見せない）。
    await computeDuplicatesStats(db, { accountIds: ['account-b'] });
    expect(callCount).toBeGreaterThan(afterFirst);
  });

  test('forceRefresh bypasses the in-isolate cache', async () => {
    let callCount = 0;
    const db = {
      prepare(sql: string) {
        const isPairwise = sql.includes('ident i1') && sql.includes('ident i2');
        return {
          first: async () => {
            callCount++;
            return { total_following: 100, duplicate_groups: 0, friend_dups: 0 };
          },
          all: async () => ({
            results: isPairwise ? [] : [],
          }),
          bind() {
            return this;
          },
        };
      },
    } as unknown as D1Database;

    await computeDuplicatesStats(db);
    const firstCallCount = callCount;
    await computeDuplicatesStats(db); // hits cache, no new query
    expect(callCount).toBe(firstCallCount);
    await computeDuplicatesStats(db, { forceRefresh: true }); // bypass
    expect(callCount).toBeGreaterThan(firstCallCount);
  });
});
