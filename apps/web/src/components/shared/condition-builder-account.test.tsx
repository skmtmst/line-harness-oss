// @vitest-environment happy-dom
/**
 * 監査 WEB065/066/067：共通の条件部品の、アカウントと世代。
 * - 065：該当件数は選んでいるアカウントで数え、アカウントを変えたら数え直す
 * - 066：古い条件の数え上げが後から届いても、今の条件の数を上書きしない
 * - 067：アカウントを変えたら前のアカウントの候補を消す。読めなかったら知らせる
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SegmentCondition } from '@/lib/segment-condition'

const fx = vi.hoisted(() => ({
  account: 'account-a',
  count: vi.fn(),
  tags: vi.fn(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fx.account }) }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => true }) }))
vi.mock('@/lib/api', () => ({
  api: {
    tags: { list: (...args: unknown[]) => fx.tags(...args) },
    friendFields: { list: vi.fn(async () => ({ success: true, data: [] })) },
    supportMarks: { list: vi.fn(async () => ({ success: true, data: [] })) },
    scenarios: { list: vi.fn(async () => ({ success: true, data: [] })) },
    segments: { count: (...args: unknown[]) => fx.count(...args) },
  },
}))

import ConditionBuilder from './condition-builder'

const cond = (text: string): SegmentCondition => ({ operator: 'AND', rules: [{ type: 'name', value: { text, targets: ['display'] } }] } as SegmentCondition)

beforeEach(() => {
  vi.useFakeTimers()
  fx.account = 'account-a'
  fx.count.mockReset()
  fx.tags.mockReset()
  fx.tags.mockResolvedValue({ success: true, data: [] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const tick = async (ms = 500) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('条件部品のアカウントと世代', () => {
  it('065：数え上げに選んでいるアカウントを付け、アカウントを変えたら数え直す', async () => {
    fx.count.mockResolvedValue({ success: true, count: 3 })
    const view = render(<ConditionBuilder value={cond('田中')} onChange={() => undefined} />)
    await tick()
    expect(fx.count).toHaveBeenLastCalledWith(expect.anything(), 'account-a')
    fx.account = 'account-b'
    view.rerender(<ConditionBuilder value={cond('田中')} onChange={() => undefined} />)
    await tick()
    expect(fx.count).toHaveBeenLastCalledWith(expect.anything(), 'account-b')
  })

  it('066：古い条件の数が後から届いても、今の条件の数のまま', async () => {
    let releaseOld: (value: unknown) => void = () => undefined
    fx.count
      .mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve }))
      .mockResolvedValueOnce({ success: true, count: 7 })
    const view = render(<ConditionBuilder value={cond('田中')} onChange={() => undefined} />)
    await tick()
    view.rerender(<ConditionBuilder value={cond('鈴木')} onChange={() => undefined} />)
    await tick()
    expect(screen.getByText('7 人')).toBeTruthy()
    await act(async () => { releaseOld({ success: true, count: 999 }) })
    expect(screen.queryByText('999 人')).toBeNull()
    expect(screen.getByText('7 人')).toBeTruthy()
  })

  it('067：候補を読めなかったら知らせる', async () => {
    fx.tags.mockRejectedValue(new Error('down'))
    render(<ConditionBuilder value={null} onChange={() => undefined} showCount={false} />)
    await tick(10)
    expect(screen.getByText(/候補を読み込めませんでした/)).toBeTruthy()
  })
})
