import { describe, expect, test } from 'vitest';
import { classifyFriend, normalizeRouting } from './friend-add-routing.js';
import { FRIEND_ADD_ROUTING_DEFAULT } from '@line-crm/shared';

describe('classifyFriend', () => {
  test('ブロックしたことが無ければ「はじめて」', () => {
    expect(classifyFriend({ id: 'f1', unfollow_count: 0 }, 'unfollow_count_zero')).toBe('first_time');
  });

  test('ブロック解除は「以前から」', () => {
    expect(classifyFriend({ id: 'f1', unfollow_count: 1 }, 'unfollow_count_zero')).toBe('returning');
    expect(classifyFriend({ id: 'f1', unfollow_count: 5 }, 'unfollow_count_zero')).toBe('returning');
  });

  test('unfollow_count が無い（古い行）は「はじめて」に倒す', () => {
    // ここを returning に倒すと、新しい友だちに welcome が届かなくなる。
    expect(classifyFriend({ id: 'f1' }, 'unfollow_count_zero')).toBe('first_time');
    expect(classifyFriend({ id: 'f1', unfollow_count: null }, 'unfollow_count_zero')).toBe('first_time');
  });

  test('初回フォロー日での判定も選べる', () => {
    expect(classifyFriend({ id: 'f1', first_followed_at: null }, 'first_followed_at_missing')).toBe('first_time');
    expect(
      classifyFriend({ id: 'f1', first_followed_at: '2026-01-01T00:00:00+09:00' }, 'first_followed_at_missing'),
    ).toBe('returning');
  });

  test('初回フォロー日での判定は、この環境では全員が「以前から」になる', () => {
    // マイグレーション 065 が既存の行すべてに初回フォロー日を埋めたため。
    // 画面でも注意書きを出している。挙動としてこうなることを固定しておく。
    const filled = { id: 'f1', unfollow_count: 0, first_followed_at: '2026-01-01T00:00:00+09:00' };
    expect(classifyFriend(filled, 'first_followed_at_missing')).toBe('returning');
    expect(classifyFriend(filled, 'unfollow_count_zero')).toBe('first_time');
  });
});

describe('normalizeRouting', () => {
  test('空の入力は既定に落ちる', () => {
    expect(normalizeRouting({})).toEqual(FRIEND_ADD_ROUTING_DEFAULT);
    expect(normalizeRouting(null)).toEqual(FRIEND_ADD_ROUTING_DEFAULT);
    expect(normalizeRouting('こわれた')).toEqual(FRIEND_ADD_ROUTING_DEFAULT);
  });

  test('既定の returning.mode は same（いままでの挙動を変えない）', () => {
    // none にすると、設定していないアカウントで配信が止まる。
    expect(FRIEND_ADD_ROUTING_DEFAULT.returning.mode).toBe('same');
  });

  test('知らない値は既定に倒す', () => {
    const out = normalizeRouting({
      firstTime: { timing: 'あした' },
      returning: { mode: 'なんとなく', startPosition: '途中から' },
      criteria: { firstTime: 'かんで判断' },
    });
    expect(out.firstTime.timing).toBe('immediate');
    expect(out.returning.mode).toBe('same');
    expect(out.returning.startPosition).toBe('beginning');
    expect(out.criteria.firstTime).toBe('unfollow_count_zero');
  });

  test('正しい値は残る', () => {
    const out = normalizeRouting({
      firstTime: { scenarioId: 's1', timing: 'scenario', actions: [{ kind: 'tag', tagId: 't1' }] },
      returning: { scenarioId: 's2', mode: 'other', startPosition: 'resume', actions: [{ kind: 'mile', amount: 100 }] },
      criteria: { firstTime: 'first_followed_at_missing' },
    });
    expect(out.firstTime).toEqual({ scenarioId: 's1', timing: 'scenario', actions: [{ kind: 'tag', tagId: 't1' }] });
    expect(out.returning).toEqual({
      scenarioId: 's2',
      mode: 'other',
      startPosition: 'resume',
      actions: [{ kind: 'mile', amount: 100 }],
    });
    expect(out.criteria.firstTime).toBe('first_followed_at_missing');
  });

  test('壊れた「あわせて実行すること」は落とす', () => {
    const out = normalizeRouting({
      firstTime: {
        actions: [
          { kind: 'tag' }, // tagId が無い
          { kind: 'tag', tagId: '' }, // 空
          { kind: 'mile', amount: 0 }, // 0マイル
          { kind: 'mile', amount: -5 }, // マイナス
          { kind: '知らない種別', foo: 1 },
          'ただの文字列',
          null,
          { kind: 'tag', tagId: 't-ok' }, // これだけ残る
        ],
      },
    });
    expect(out.firstTime.actions).toEqual([{ kind: 'tag', tagId: 't-ok' }]);
  });

  test('マイルの端数は切り捨てる', () => {
    const out = normalizeRouting({ firstTime: { actions: [{ kind: 'mile', amount: 10.7 }] } });
    expect(out.firstTime.actions).toEqual([{ kind: 'mile', amount: 10 }]);
  });

  test('空文字のシナリオIDは null（未設定）にする', () => {
    // '' のまま通すと「決めた」と誤って扱われ、全部流す経路に落ちない。
    expect(normalizeRouting({ firstTime: { scenarioId: '' } }).firstTime.scenarioId).toBeNull();
  });
});
