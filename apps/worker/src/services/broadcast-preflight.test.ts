import { describe, expect, it } from 'vitest';
import { buildWarnings, countAudience } from './broadcast-preflight.js';
import { buildSegmentQuery, type SegmentCondition } from './segment-query.js';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';

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

/*
 * 詳細条件で絞ったときの人数。
 *
 * ここが条件を無視すると、**そのアカウントの全員**の人数が出る。
 * 12人に送るつもりの画面に「312人に届きます」と出たまま送信を押すことに
 * なる。一斉配信は取り消せないので、実際より多い数字を出すのが
 * いちばん危ない間違い方になる。
 */
describe('詳細条件で絞ったときの人数', () => {
  const VIP_CONDITION: SegmentCondition = {
    operator: 'AND',
    rules: [
      { type: 'is_following', value: true },
      { type: 'tag_exists', value: 't-vip' },
    ],
  }

  function setup() {
    const { db, raw } = createTestD1()
    insertFriend(raw, 'f1')
    insertFriend(raw, 'f2')
    insertFriend(raw, 'f3')
    insertFriend(raw, 'f4', { is_following: 0 })
    insertFriend(raw, 'f5', { is_hidden: 1 })
    raw.prepare(`INSERT INTO tags (id, name) VALUES ('t-vip', 'VIP')`).run()
    for (const f of ['f1', 'f4', 'f5']) {
      raw.prepare(`INSERT INTO friend_tags (friend_id, tag_id) VALUES (?, 't-vip')`).run(f)
    }
    return { db, raw }
  }

  it('条件で絞った人数を返す', async () => {
    const { db } = setup()
    const result = await countAudience(db, {
      targetType: 'segment',
      segmentConditions: VIP_CONDITION,
    })
    // VIP は f1 / f4 / f5。f4 はブロック中で条件から外れ、
    // f5 は非表示なので届く人数には入らず、除外として数える。
    expect(result).toEqual({ total: 1, hiddenExcluded: 1 })
  })

  it('条件を渡さなければ絞り込まれない（渡し忘れると全員の人数が出る）', async () => {
    // VIP は1人しかいないのに、条件を渡さないとブロック中・非表示を除いた
    // 全員の人数が返る。渡し忘れが「多い側」に外れることを、ここで固定する。
    const { db } = setup()
    const result = await countAudience(db, { targetType: 'segment' })
    expect(result.total).toBe(3)
  })

  it('数えた人数と、実際に送る相手が同じ組み立てで決まる', async () => {
    // 別々に書くと、条件を1つ足したときにどちらかだけ直して食い違う。
    const { db, raw } = setup()
    const counted = await countAudience(db, { targetType: 'segment', segmentConditions: VIP_CONDITION })
    const query = buildSegmentQuery(VIP_CONDITION)
    const sent = raw.prepare(query.sql).all(...(query.bindings as never[])) as Array<{ id: string }>
    // 送信側は非表示の人も含むので、その差だけがずれの許される範囲。
    expect(sent.length).toBe(counted.total + counted.hiddenExcluded)
  })
})
