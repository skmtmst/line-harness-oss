import { describe, expect, it } from 'vitest'

import { broadcastSteps, type BroadcastStepInput } from './broadcast-steps'

const NOTHING: BroadcastStepInput = {
  basicDone: false,
  audienceDone: false,
  messageDone: false,
  scheduleDone: false,
}

describe('作成画面の5段（設計 LMiL2）', () => {
  it('設計と同じ5段を、同じ順・同じ名前で出す', () => {
    expect(broadcastSteps(NOTHING).map((step) => [step.order, step.label])).toEqual([
      [1, '基本設定'],
      [2, '対象者'],
      [3, 'メッセージ'],
      [4, '送信設定'],
      [5, '確認'],
    ])
  })

  it('何も入っていなければ、現在地は先頭の1つだけ', () => {
    const states = broadcastSteps(NOTHING).map((step) => step.state)
    expect(states).toEqual(['current', 'todo', 'todo', 'todo', 'todo'])
  })

  it('埋まったぶんだけ done になり、次の1つが現在地になる', () => {
    const states = broadcastSteps({ ...NOTHING, basicDone: true, audienceDone: true }).map((s) => s.state)
    expect(states).toEqual(['done', 'done', 'current', 'todo', 'todo'])
  })

  /**
   * 飛び石に緑が点かないこと。
   *
   * 送信設定だけ先に決めても「基本設定が済んだ」ようには見せない。
   * 帯が左から順に進むものとして描かれているので、後ろだけ緑になると
   * どこまで済んだのか読めなくなる。
   */
  it('後ろの段だけ埋まっていても done にしない', () => {
    const states = broadcastSteps({ ...NOTHING, scheduleDone: true }).map((s) => s.state)
    expect(states).toEqual(['current', 'todo', 'todo', 'todo', 'todo'])
  })

  it('4段そろって初めて「確認」が現在地になる。done にはしない', () => {
    const steps = broadcastSteps({
      basicDone: true,
      audienceDone: true,
      messageDone: true,
      scheduleDone: true,
    })
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'current'])
  })

  it('段はどれも飛び先の id を持つ（押しても動かない飾りにしない）', () => {
    for (const step of broadcastSteps(NOTHING)) {
      expect(step.anchor, `${step.label} に飛び先がありません`).toMatch(/^broadcast-step-[a-z]+$/)
    }
    const anchors = broadcastSteps(NOTHING).map((s) => s.anchor)
    expect(new Set(anchors).size).toBe(anchors.length)
  })
})
