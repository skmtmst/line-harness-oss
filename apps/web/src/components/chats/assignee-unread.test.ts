import { describe, expect, it } from 'vitest'
import { NOT_AVAILABLE, assigneeOptions, shouldDropStats } from './assignee-unread'

const operators = [
  { id: 'operator-kenta', name: 'Kenta' },
  { id: 'operator-masato', name: 'Masato' },
]

const unread = [
  { operatorId: null, operatorName: null, unread: 2 },
  { operatorId: 'operator-kenta', operatorName: 'Kenta', unread: 3 },
]

describe('担当者ごとの未読数', () => {
  it('未読数を名前に添える', () => {
    const options = assigneeOptions(operators, unread)
    expect(options.find((o) => o.value === 'unassigned')?.label).toBe('未割り当て 2')
    expect(options.find((o) => o.value === 'operator-kenta')?.label).toBe('Kenta 3')
  })

  it('配列に出てこない担当者は実値0', () => {
    /*
      0件の担当者は配列に載らない契約。`—` にすると「読めていない」と
      読めてしまうので、0と書く。
    */
    const masato = assigneeOptions(operators, unread).find((o) => o.value === 'operator-masato')
    expect(masato?.unread).toBe(0)
    expect(masato?.label).toBe('Masato 0')
  })

  it('集計が読めていないときは数だけ —', () => {
    const options = assigneeOptions(operators, null)
    for (const value of ['unassigned', 'operator-kenta', 'operator-masato']) {
      const option = options.find((o) => o.value === value)
      expect(option?.unread).toBeNull()
      expect(option?.label.endsWith(NOT_AVAILABLE)).toBe(true)
    }
  })

  it('集計が失敗しても選択肢を消さない', () => {
    /*
      担当者一覧は `/api/operators` の結果で、集計とは別の口。
      消すと、選んでいた担当者が画面から消える。
    */
    expect(assigneeOptions(operators, null).map((o) => o.value))
      .toEqual(['all', 'unassigned', 'operator-kenta', 'operator-masato'])
  })

  it('0件の担当者も選択肢から消さない', () => {
    expect(assigneeOptions(operators, []).map((o) => o.value))
      .toEqual(['all', 'unassigned', 'operator-kenta', 'operator-masato'])
    expect(assigneeOptions(operators, []).find((o) => o.value === 'operator-kenta')?.label)
      .toBe('Kenta 0')
  })

  it('「すべて」は担当者ではないので数を付けない', () => {
    const all = assigneeOptions(operators, unread).find((o) => o.value === 'all')
    expect(all?.label).toBe('すべて')
    expect(all?.unread).toBeNull()
  })

  it('担当未設定は operatorId が null の行から数える', () => {
    const only = [{ operatorId: null, operatorName: null, unread: 7 }]
    expect(assigneeOptions(operators, only).find((o) => o.value === 'unassigned')?.label)
      .toBe('未割り当て 7')
  })

  it('実値0と未取得を同じ文字にしない', () => {
    const zero = assigneeOptions(operators, []).find((o) => o.value === 'operator-kenta')?.label
    const missing = assigneeOptions(operators, null).find((o) => o.value === 'operator-kenta')?.label
    expect(zero).not.toBe(missing)
  })
})

describe('アカウント切替', () => {
  it('切り替わったら前の集計を捨てる', () => {
    // 読み終わるまで残すと、別のアカウントの未読数を見たまま担当者を選ぶ。
    expect(shouldDropStats('acc-1', 'acc-2')).toBe(true)
    expect(shouldDropStats(null, 'acc-1')).toBe(true)
    expect(shouldDropStats('acc-1', 'acc-1')).toBe(false)
  })
})
