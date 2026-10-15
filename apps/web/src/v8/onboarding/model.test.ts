import { describe, expect, it } from 'vitest'
import { answerOf, choiceLabel, needsActivation, pairStarterItems, questionsFor, recommendedValue, stepNames, summarizeSetup } from './model'

const state = {
  style: 'restaurant' as const, styleSelected: true, version: 1,
  answers: {
    image: { mode: 'configured' as const, value: 'keep' },
    approval: { mode: 'configured' as const, value: 'automatic' },
    payment: { mode: 'later' as const },
    stamps: { mode: 'later' as const },
  },
}

describe('はじめの質問の決まり（B-313・組4の質問キー）', () => {
  it('質問は口の質問キーだけ。飲食店向けはスタイル・見た目＋7問', () => {
    const keys = ['image', 'booking', 'approval', 'payment', 'reminders', 'stamps', 'coupons', 'tickets', 'outcome', 'content']
    expect(stepNames('restaurant').map((step) => step.key)).toEqual(['style', 'image', 'booking', 'approval', 'payment', 'reminders', 'stamps', 'coupons', 'content'])
    for (const style of ['restaurant', 'salon', 'consult', 'lesson', 'ec', 'standard'] as const) {
      for (const q of questionsFor(style)) expect(keys, q.key).toContain(q.key)
    }
  })

  it('はい・いいえの答えは真偽で、あとで・手動は mode だけで送る', () => {
    expect(answerOf('true')).toEqual({ mode: 'configured', value: true })
    expect(answerOf('false')).toEqual({ mode: 'configured', value: false })
    expect(answerOf('manual')).toEqual({ mode: 'manual' })
    expect(answerOf('later')).toEqual({ mode: 'later' })
    expect(answerOf('automatic')).toEqual({ mode: 'configured', value: 'automatic' })
  })

  it('おすすめは業種ごとに先に選び、題に「（おすすめ）」を付ける', () => {
    const approval = questionsFor('consult').find((q) => q.key === 'approval')!
    expect(recommendedValue(approval, 'consult')).toBe('manual')
    expect(choiceLabel(approval, approval.choices[1], 'consult')).toBe('お店が承認してから確定する（おすすめ）')
  })
})

describe('入った物の突き合わせ', () => {
  it('item_key が無いので種類ごとに並びで名前を付け、止めた予約メニュー・下書きのお知らせを動かす対象にする', () => {
    const pairs = pairStarterItems(
      [{ key: 'a', kind: 'automation', name: '前日のお知らせ' }, { key: 'm', kind: 'booking_menu', name: 'ランチ' }],
      [{ target_id: 'x', kind: 'booking_menu', is_sample: 1, status: 'inactive', draftRevision: null }, { target_id: 'y', kind: 'automation', is_sample: 1, status: 'draft', draftRevision: 'd1' }],
    )
    expect(pairs.map((pair) => [pair.state.target_id, pair.item.name])).toEqual([['x', 'ランチ'], ['y', '前日のお知らせ']])
    expect(pairs.every((pair) => needsActivation(pair.state))).toBe(true)
  })
})

describe('はじめにやること（Bdfxm）', () => {
  it('警告・あとで・止めている物・見本の画像を 1 行ずつ。警告と同じ機能の「あとで」は重ねない', () => {
    const summary = summarizeSetup(
      state,
      [{ feature: 'stamps', areaId: 'E', groupId: 'g', href: '/visit-stamps', customerState: 'preparing' }],
      [{ target_id: 'a1', kind: 'automation', is_sample: 1, status: 'draft', draftRevision: 'd' }],
    )
    expect(summary.rows.map((row) => row.title)).toEqual(['来店スタンプの決まりを入れる', 'Stripe をつなぐ', '入った予約メニュー・お知らせを動かす', 'お店の写真とロゴを入れる'])
    expect(summary.rows[0].action.href).toBe('/visit-stamps')
    expect(summary.rows[1].action.preparing).toBe('お支払い')
    expect(summary.done).toBe(3)
    expect(summary.total).toBe(9)
  })

  it('未定（あとで）の質問は入れない：答えが無い物は済みに数えず、行も出さない', () => {
    const summary = summarizeSetup({ ...state, answers: {} }, [], [])
    expect(summary.done).toBe(1)
    expect(summary.rows).toEqual([])
  })
})
