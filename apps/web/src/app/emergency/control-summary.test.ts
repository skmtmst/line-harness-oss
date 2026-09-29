import { describe, expect, it } from 'vitest'
import { operationControlSummary } from './control-summary'

describe('健全性タブの緊急停止概要', () => {
  it('停止IDがあれば停止中と理由を表示する', () => {
    expect(operationControlSummary({ activeIncidentId: 'incident-1', reason: '誤配信を止めるため' }))
      .toEqual({ value: '停止中', note: '誤配信を止めるため' })
  })

  it('停止IDがなければ通常運用、理由がなければ未入力と表示する', () => {
    expect(operationControlSummary({ activeIncidentId: null, reason: null }))
      .toEqual({ value: '通常運用', note: '停止なし' })
    expect(operationControlSummary({ activeIncidentId: 'incident-2', reason: null }))
      .toEqual({ value: '停止中', note: '停止理由は未入力です' })
  })
})
