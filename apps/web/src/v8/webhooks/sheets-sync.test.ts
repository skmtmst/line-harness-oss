/*
 * 監査 WEB233：Google スプレッドシートの同期が HTTP 200 のまま失敗を返したとき、理由を出す。
 */
import { describe, expect, it } from 'vitest'
import { syncResultProblem } from './sheets'

describe('同期の結果（WEB233）', () => {
  it('失敗・一部・実行中は理由を返す', () => {
    expect(syncResultProblem({ status: 'error', results: [{ status: 'error', error: '権限がありません' }] })).toBe('同期できませんでした（権限がありません）')
    expect(syncResultProblem({ status: 'partial', results: [] })).toContain('一部だけ')
    expect(syncResultProblem({ status: 'already_running', results: [] })).toContain('いま同期しています')
  })
  it('うまくいったら何も出さない（対照）', () => {
    expect(syncResultProblem({ status: 'ok', results: [] })).toBeNull()
  })
})
