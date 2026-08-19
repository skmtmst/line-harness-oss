import { describe, expect, test } from 'vitest';
import { applyFriendAddRouting, classifyFriend, normalizeRouting, saveFriendAddRouting } from './friend-add-routing.js';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
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

/*
 * ブロックを解除した人に、ちゃんと届くか。
 *
 * ブロック中は購読が止まったまま残る（status='paused'）。この状態で
 * `enrollFriendInScenario` を呼ぶと、部分UNIQUE索引（status != 'completed'）に
 * 弾かれて null が返る。**登録もされず、再開もされず、何も起きない。**
 * 解除した本人にも、設定した人にも、何が起きていないのか分からない。
 *
 * 「はじめての人と同じものを配信する」を選んでいると、以前はここに
 * 落ちていた（開始位置が「別のシナリオ」のときしか見られていなかった）。
 */
describe('ブロックを解除した人への配信', () => {
  async function setup(mode: 'same' | 'other', startPosition: 'resume' | 'beginning') {
    const { db, raw } = createTestD1()
    raw.prepare(`INSERT INTO line_accounts (id, name, channel_id, channel_secret, channel_access_token)
                 VALUES ('acc-1', 'テスト', 'c', 's', 't')`).run()
    insertFriend(raw, 'f-back', { line_account_id: 'acc-1', unfollow_count: 1 })
    raw.prepare(`INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
                 VALUES ('sc-1', 'ようこそ', 'friend_add', 1, 'acc-1')`).run()
    raw.prepare(`INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content)
                 VALUES ('st-1','sc-1',0,0,'text','1通目'), ('st-2','sc-1',1,60,'text','2通目')`).run()
    // 1通目まで読んだところでブロックされ、購読が止まっている。
    raw.prepare(`INSERT INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, updated_at)
                 VALUES ('fs-1','f-back','sc-1',0,'paused','2026-01-01T00:00:00.000','2026-01-01T00:00:00.000')`).run()

    await saveFriendAddRouting(db, 'acc-1', {
      ...FRIEND_ADD_ROUTING_DEFAULT,
      firstTime: { ...FRIEND_ADD_ROUTING_DEFAULT.firstTime, scenarioId: 'sc-1' },
      returning: {
        ...FRIEND_ADD_ROUTING_DEFAULT.returning,
        mode,
        scenarioId: mode === 'other' ? 'sc-1' : null,
        startPosition,
      },
    })
    return { db, raw }
  }

  test('「同じもの」＋「前回読んだところから」で、止まった購読が動き出す', async () => {
    const { db, raw } = await setup('same', 'resume')
    const result = await applyFriendAddRouting(db, 'acc-1', { id: 'f-back', unfollow_count: 1 })

    expect(result.kind).toBe('returning')
    expect(result.enrollments).toHaveLength(1)
    expect(result.enrollments[0].resumed).toBe(true)

    const rows = raw.prepare(`SELECT status, current_step_order FROM friend_scenarios WHERE friend_id = 'f-back'`)
      .all() as Array<{ status: string; current_step_order: number }>
    // 増やさずに、元の行が動く。1通目は送り直さない。
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('active')
    expect(rows[0].current_step_order).toBe(0)
  })

  test('「別のシナリオ」でも、これまでどおり動く', async () => {
    const { db } = await setup('other', 'resume')
    const result = await applyFriendAddRouting(db, 'acc-1', { id: 'f-back', unfollow_count: 1 })
    expect(result.enrollments[0]?.resumed).toBe(true)
  })

  test('「最初から」を選んでいれば、止まったままにする（選んだとおりにふるまう）', async () => {
    // ここで勝手に再開すると、設定した人の指定を無視することになる。
    // 何も起きないことは、画面の説明文で先に伝える。
    const { db, raw } = await setup('same', 'beginning')
    const result = await applyFriendAddRouting(db, 'acc-1', { id: 'f-back', unfollow_count: 1 })
    expect(result.enrollments).toHaveLength(0)

    const row = raw.prepare(`SELECT status FROM friend_scenarios WHERE friend_id = 'f-back'`)
      .get() as { status: string }
    expect(row.status).toBe('paused')
  })
})
