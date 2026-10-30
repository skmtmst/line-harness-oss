// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { ApiError, describeSaveFailure } from '@/lib/api'
import { fieldMigrationFailureMessage } from './field-migrate'
import { firstStepFailureMessage } from '@/v8/scenario-first-step/first-step'
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())

describe('移行を重ねて実行させない案内', () => {
  it.each(['start', 'resume'] as const)('%sは409の状態・受け付け済みを残し、401はログインへ案内する', phase => {
    for (const [code, text] of [
      ['RUN_STATE_CHANGED', '移行状態が変わりました。実行状況を確認してください'],
      ['IDEMPOTENCY_CONFLICT', '同じ操作はすでに受け付けています'],
    ]) expect(fieldMigrationFailureMessage(new ApiError(409, text, code), phase)).toBe(text)
    const unauthorized = new ApiError(401)
    expect(fieldMigrationFailureMessage(unauthorized, phase)).toBe(describeSaveFailure(unauthorized))
    expect(fieldMigrationFailureMessage(unauthorized, phase)).not.toContain('事前確認')
    expect(fieldMigrationFailureMessage(new ApiError(400, '移行先を選んでください。'), phase)).toBe('入力を直してください。移行先を選んでください。')
  })
  it.each(['start', 'resume'] as const)('%sは通信断と5xxだけを事前確認へ戻す', phase => {
    const action = phase === 'start' ? '開始' : '再開'
    for (const reason of [new TypeError('Failed to fetch'), new ApiError(503, 'D1_ERROR SELECT secret')]) {
      expect(fieldMigrationFailureMessage(reason, phase)).toBe(`移行を${action}できませんでした。事前確認からやり直してください。`)
    }
  })
})

describe('1通目の入力と次の操作を残す', () => {
  it('通信断と5xxは再試行の案内を1回だけ出す', () => {
    for (const reason of [new TypeError('Failed to fetch'), new ApiError(500)]) {
      expect(firstStepFailureMessage(reason, 'save')).toBe('保存できませんでした。入力内容は残っています。通信状態を確認して、もう一度お試しください。')
    }
  })
  it('409と入力の理由には通信の確認を付けない', () => {
    expect(firstStepFailureMessage(new ApiError(409, '別の人が先に変更しました。読み直してください。'), 'save')).toBe('別の人が先に変更しました。読み直してください。入力内容は残っています。')
    expect(firstStepFailureMessage(new ApiError(400, '本文を入力してください。'), 'save')).toBe('入力を直してください。本文を入力してください。入力内容は残っています。')
    expect(firstStepFailureMessage(new ApiError(503), 'load')).toBe('読み込みに失敗しました。時間をおいて、もう一度お試しください。')
    expect(firstStepFailureMessage(new Error('シナリオがありません。'), 'load')).toBe('シナリオがありません。')
  })
})
