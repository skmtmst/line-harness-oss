// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ account: 'account-a', rules: vi.fn(), save: vi.fn(), publish: vi.fn(), stop: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.account, loading: false }) }))
vi.mock('@/lib/staff-role', async (original) => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, actionScores: { ...actual.api.actionScores, rules: state.rules, saveDraft: state.save, publishRules: state.publish, stopRules: state.stop } } }
})
import ActionScoreRulesPage from './score-rules'

const version = { id: 'draft-1', versionNumber: 1, status: 'draft', createdAt: '2026-01-01', publishedAt: null, bands: { min: 0, max: 100, normalMin: 10, highMin: 30 }, rules: [{ id: 'rule-1', name: '来店', eventType: 'booking_created', source: 'booking', operation: 'delta', value: 1, frequency: { kind: 'per_day', limit: 1 }, enabled: true }] }
const configuration = { configured: true, status: 'published', currentDraftVersionId: 'draft-1', currentPublishedVersionId: 'published-1', editableVersion: version, publishedVersion: version }
beforeEach(() => { state.account = 'account-a'; state.rules.mockResolvedValue({ success: true, data: configuration }); state.save.mockResolvedValue({ success: true, data: configuration }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

it.each(['publish', 'stop'] as const)('%s の確かめに操作先と環境を示す', async kind => {
  render(<ActionScoreRulesPage />)
  const button = await screen.findByRole('button', { name: kind === 'publish' ? 'スコアのルールを公開' : '公開中のルールを停止' })
  fireEvent.click(button)
  const dialog = await screen.findByRole(kind === 'publish' ? 'dialog' : 'alertdialog')
  expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
  expect(within(dialog).getByText('環境')).toBeTruthy()
})

it.each(['publish', 'stop'] as const)('%s はアカウントを切り替えて戻した古い確定を送らない', async kind => {
  const view = render(<ActionScoreRulesPage />)
  fireEvent.click(await screen.findByRole('button', { name: kind === 'publish' ? 'スコアのルールを公開' : '公開中のルールを停止' }))
  const dialog = await screen.findByRole(kind === 'publish' ? 'dialog' : 'alertdialog')
  const button = within(dialog).getByRole('button', { name: kind === 'publish' ? 'この版を公開' : '公開中のルールを停止' })
  const key = Object.keys(button).find(item => item.startsWith('__reactProps$'))!
  const handler = (button as unknown as Record<string, { onClick: (event: unknown) => unknown }>)[key].onClick
  state.account = 'account-b'; view.rerender(<ActionScoreRulesPage />)
  state.account = 'account-a'; view.rerender(<ActionScoreRulesPage />)
  await act(async () => { await handler({ defaultPrevented: false, preventDefault() {}, stopPropagation() {}, currentTarget: button, target: button }) })
  expect(state.publish).not.toHaveBeenCalled()
  expect(state.stop).not.toHaveBeenCalled()
})
