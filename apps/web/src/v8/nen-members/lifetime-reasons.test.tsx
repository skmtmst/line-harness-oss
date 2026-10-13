// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { NenRankSettingsData } from '@/lib/nen-ranks-api'
import Lifetime from './lifetime'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
afterEach(cleanup)
const settings: NenRankSettingsData = {
  ranks: [], rules: null,
  milestones: [{ id: 'm1', thresholdYen: 50000, title: '常連', benefitKind: null, benefitNote: null, notifyOnReach: true, reachedCount: 3 }],
  kpis: { members: 0, annualTotalYen: 0, lifetimeTotalYen: 0, balanceTotal: 0, usedThisMonth: 0, byRank: {} },
}

it('未変更の理由を示し、節目を変えると保存でき、キャンセルで元へ戻る', () => {
  render(<Lifetime accountId="a" status="ready" settings={settings} onSaved={vi.fn()} onRetry={vi.fn()} readonly={false} />)
  const save = screen.getByRole('button', { name: '保存して EC へ同期する' }) as HTMLButtonElement
  const cancel = screen.getByRole('button', { name: 'キャンセル' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  expect(save.title).toBe('節目を変更すると保存できます')
  expect(cancel.title).toBe('変更がありません')
  fireEvent.click(screen.getByRole('button', { name: /節目.*常連.*操作/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: '削除する' }))
  expect(save.disabled).toBe(false)
  expect(save.title).toBe('')
  fireEvent.click(cancel)
  expect(screen.getByText('常連')).toBeTruthy()
  expect(save.disabled).toBe(true)
  expect(save.title).toBe('節目を変更すると保存できます')
})

it('閲覧のみの人には保存も変更操作も置かない', () => {
  render(<Lifetime accountId="a" status="ready" settings={settings} onSaved={vi.fn()} onRetry={vi.fn()} readonly />)
  expect(screen.getByText('常連')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '保存して EC へ同期する' })).toBeNull()
  expect(screen.queryByRole('button', { name: /節目.*操作/ })).toBeNull()
})
