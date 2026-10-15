import { describe, expect, it } from 'vitest'
import { choiceLabel, questionsFor, recommendedValue, stepNames, summarizeSetup } from './model'

const state = {
  style: 'restaurant' as const, styleSelected: true, version: 1,
  answers: {
    look: { mode: 'configured' as const, value: 'sample' },
    confirmation: { mode: 'configured' as const, value: 'instant' },
    payment: { mode: 'later' as const },
    visitStamp: { mode: 'later' as const },
  },
}

describe('はじめの質問の決まり（B-313）', () => {
  it('飲食店向けは 11 問（スタイル・見た目・質問 9）。EC・標準は予約の質問を出さない', () => {
    expect(stepNames('restaurant').map((step) => step.short)).toEqual(['使い方のスタイル', '見た目', '予約の確定の仕方', 'お支払い', 'キャンセルの期限', '前日のお知らせ', '来店スタンプ', 'クーポン', '席・卓', '営業時間', '受け付ける人数'])
    expect(questionsFor('ec').map((q) => q.key)).toEqual(['coupon'])
  })

  it('どの質問にも「あとから変えられます（どこで）」と手動の行き先がある', () => {
    for (const style of ['restaurant', 'salon', 'consult', 'lesson'] as const) {
      for (const q of questionsFor(style)) {
        expect(q.where.length, q.key).toBeGreaterThan(0)
        expect(q.manualHref.startsWith('/'), q.key).toBe(true)
      }
    }
  })

  it('おすすめは業種ごとに先に選び、題に「（おすすめ）」を付ける', () => {
    const confirmation = questionsFor('consult')[0]
    expect(recommendedValue(confirmation, 'consult')).toBe('approval')
    expect(choiceLabel(confirmation, confirmation.choices[1], 'consult')).toBe('お店が承認してから確定する（おすすめ）')
    expect(choiceLabel(confirmation, confirmation.choices[0], 'consult')).toBe('その場で確定する')
  })
})

describe('はじめにやること（Bdfxm）', () => {
  it('警告・あとで・止めている自動の送信・見本の画像を 1 行ずつ。警告と同じ機能の「あとで」は重ねない', () => {
    const summary = summarizeSetup(
      state,
      [{ feature: 'visit_stamp', areaId: 'E', groupId: 'g', href: '/visit-stamps', customerState: 'preparing' }],
      [{ target_id: 'a1', kind: 'automation', is_sample: 1, status: 'stopped', draftRevision: null }],
    )
    expect(summary.rows.map((row) => row.title)).toEqual(['来店スタンプの決まりを入れる', 'Stripe をつなぐ', '前日・当日のお知らせを動かす', 'お店の写真とロゴを入れる'])
    expect(summary.rows[0].badge).toEqual({ tone: 'warning', label: '未設定' })
    expect(summary.rows[1].action.preparing).toBe('お支払い')
    expect(summary.done).toBe(3)
    expect(summary.total).toBe(11)
    expect(summary.nextStep).toBe(3)
  })

  it('未定（あとで）の質問は入れない：答えが無い・あとでの物は済みに数えない', () => {
    const summary = summarizeSetup({ ...state, answers: {} }, [], [])
    expect(summary.done).toBe(1)
    expect(summary.rows).toEqual([])
  })
})
