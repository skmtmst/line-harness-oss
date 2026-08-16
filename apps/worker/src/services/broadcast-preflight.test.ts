import { describe, expect, it } from 'vitest';
import { buildWarnings, countAudience } from './broadcast-preflight.js';

/** first だけを返す最小のモック。SQLとバインドも見られるようにする。 */
function makeDb(row: { total: number | null; hidden: number | null } | null) {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          calls.push({ sql, binds });
          return {
            async first() {
              return row;
            },
          };
        },
        async first() {
          calls.push({ sql, binds: [] });
          return row;
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe('届く人数', () => {
  it('非表示の人は数えず、除外した人数を別に返す', async () => {
    // 「こちらから見えなくした人」に配信が飛ぶと、非表示にした意味がない。
    const { db } = makeDb({ total: 120, hidden: 5 });
    const result = await countAudience(db, { targetType: 'all' });
    expect(result).toEqual({ total: 120, hiddenExcluded: 5 });
  });

  it('タグ指定なのにタグが無ければ0人', async () => {
    const { db, calls } = makeDb({ total: 999, hidden: 0 });
    const result = await countAudience(db, { targetType: 'tag' });
    expect(result.total).toBe(0);
    // 数えるまでもないので問い合わせない。
    expect(calls).toHaveLength(0);
  });

  it('タグがあれば絞り込みに入る', async () => {
    const { db, calls } = makeDb({ total: 30, hidden: 0 });
    await countAudience(db, { targetType: 'tag', targetTagId: 't-1' });
    expect(calls[0].sql).toContain('friend_tags');
    expect(calls[0].binds).toContain('t-1');
  });

  it('複数アカウントで対象が空なら0人', async () => {
    const { db, calls } = makeDb({ total: 999, hidden: 0 });
    const result = await countAudience(db, {
      targetType: 'multi-account-dedup',
      accountIds: [],
    });
    expect(result.total).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('行が無くても0で返す', async () => {
    const { db } = makeDb(null);
    expect(await countAudience(db, { targetType: 'all' })).toEqual({
      total: 0,
      hiddenExcluded: 0,
    });
  });
});

describe('注意の組み立て', () => {
  it('0人なら警告を出す', () => {
    const warnings = buildWarnings({ total: 0, hiddenExcluded: 0 });
    expect(warnings[0].level).toBe('warning');
    expect(warnings[0].message).toContain('0人');
  });

  it('20人未満は開封が取れないことを伝える', () => {
    // 送れないわけではないので、注意にとどめる。
    const warnings = buildWarnings({ total: 12, hiddenExcluded: 0 });
    expect(warnings[0].level).toBe('info');
    expect(warnings[0].message).toContain('20人未満');
  });

  it('20人以上なら人数の注意は出ない', () => {
    const warnings = buildWarnings({ total: 20, hiddenExcluded: 0 });
    expect(warnings.some((w) => w.message.includes('20人未満'))).toBe(false);
  });

  it('非表示で除外した人数を伝える', () => {
    const warnings = buildWarnings({ total: 100, hiddenExcluded: 3 });
    expect(warnings.some((w) => w.message.includes('3 人'))).toBe(true);
  });

  it('除外が0なら何も言わない', () => {
    const warnings = buildWarnings({ total: 100, hiddenExcluded: 0 });
    expect(warnings).toEqual([]);
  });

  it('直近に同じ内容があれば警告する', () => {
    // 冪等キーは同じリクエストの再送を防ぐが、人が2回作って2回押す場合は
    // 別のリクエストなので通ってしまう。
    const warnings = buildWarnings({ total: 100, hiddenExcluded: 0 }, { hasRecentSimilar: true });
    expect(warnings[0].level).toBe('warning');
    expect(warnings[0].message).toContain('二重');
  });

  it('送信は止めない（注意を返すだけ）', () => {
    // ここで弾くと、意図して少人数へ送りたい場合に送れなくなる。
    expect(() => buildWarnings({ total: 0, hiddenExcluded: 0 })).not.toThrow();
  });
});
