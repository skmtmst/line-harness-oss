// @vitest-environment happy-dom
/**
 * 監査 R258：名前の検索対象を全て外すと、判定は逆に全名前欄へ広がる。
 *
 * 共通の条件部品で直し、全画面に効かせる。最後の1つは外さず、
 * 欄の下で理由を知らせる。判定側（packages/db）は空配列を全欄へ
 * 広げず作り直しを促す（worker の試験で守る）。
 */
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConditionBuilder from './condition-builder'
import type { SegmentCondition } from '@/lib/segment-condition'

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1' }),
}))
vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ enabled: () => true }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    tags: { list: vi.fn(async () => ({ success: true, data: [] })) },
    friendFields: { list: vi.fn(async () => ({ success: true, data: [] })) },
    supportMarks: { list: vi.fn(async () => ({ success: true, data: [] })) },
    scenarios: { list: vi.fn(async () => ({ success: true, data: [] })) },
    segments: { count: vi.fn(async () => ({ success: true, count: 0 })) },
  },
}))

afterEach(() => cleanup())

const NOTICE = /検索対象は1つ以上必要です/

function Harness({ initial }: { initial: SegmentCondition }) {
  const [value, setValue] = useState<SegmentCondition | null>(initial)
  return <ConditionBuilder value={value} onChange={setValue} showCount={false} />
}

function targetBox(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name }) as HTMLInputElement
}

describe('R258 名前の検索対象は1つ以上必要', () => {
  it('最後の1つを外そうとしても外れず、欄の下で理由が出る', () => {
    render(
      <Harness
        initial={{
          operator: 'AND',
          rules: [{ type: 'name', value: { text: '田中', targets: ['display'] } }],
        }}
      />,
    )
    const box = targetBox('LINE登録名')
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    // 外れていない（全欄へ広がる状態を作らない）。
    expect(targetBox('LINE登録名').checked).toBe(true)
    expect(screen.getByText(NOTICE)).toBeTruthy()
  })

  it('2つ以上あるときはその1つだけ外せる', () => {
    render(
      <Harness
        initial={{
          operator: 'AND',
          rules: [{ type: 'name', value: { text: '田中', targets: ['display', 'real'] } }],
        }}
      />,
    )
    fireEvent.click(targetBox('LINE登録名'))
    expect(targetBox('LINE登録名').checked).toBe(false)
    expect(targetBox('本名').checked).toBe(true)
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('空のまま開いた昔の条件では案内が出る（選び直しを促す）', () => {
    render(
      <Harness
        initial={{
          operator: 'AND',
          rules: [{ type: 'name', value: { text: '田中', targets: [] } }],
        }}
      />,
    )
    expect(screen.getByText(NOTICE)).toBeTruthy()
  })
})
