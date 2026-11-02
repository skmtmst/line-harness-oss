// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ account: 'account-a', get: vi.fn(), update: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), useSearchParams: () => new URLSearchParams('id=question-1') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: state.account, accounts: [], loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/use-feature-access', () => ({ useFeatureAccess: () => true }))
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
vi.mock('@/lib/api', async original => {
 const actual = await original<typeof import('@/lib/api')>()
 return { ...actual, api: { ...actual.api, templates: { ...actual.api.templates, get: state.get, update: state.update }, folders: { ...actual.api.folders, list: async () => ({ success: true, data: [] }) }, tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) }, scenarios: { ...actual.api.scenarios, list: async () => ({ success: true, data: [] }) } } }
})
import QuestionNewV8 from './question-new'
beforeEach(() => { state.account='account-a'; state.get.mockResolvedValue({ success: true, data: { name: '質問', accountId: 'account-a', question: { text: 'よろしいですか', tapMode: 'single', choices: [{ key: 'yes', label: 'はい', behavior: 'none' }] }, usedBy: { scenarios: [{ id: 'scenario' }] }, publishedVersion: 1, draftRevision: 1 } }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
async function open() { fireEvent.click(await screen.findByRole('button', { name: '保存して公開' })); return screen.findByRole('dialog', { name: 'この質問を公開しますか？' }) }
it('公開の確認に対象を表示する', async () => {
 render(<QuestionNewV8 />)
 const dialog = await open()
 expect(within(dialog).getByText('LINEアカウント')).toBeTruthy()
 expect(within(dialog).getByText('環境')).toBeTruthy()
})
it('アカウントを切り替えて戻した古い確認では公開しない', async () => {
 const view = render(<QuestionNewV8 />)
 const dialog = await open()
 const button = within(dialog).getByRole('button', { name: '公開する' })
 const key = Object.keys(button).find(item => item.startsWith('__reactProps$'))!
 const handler = (button as unknown as Record<string, { onClick: (event: unknown) => unknown }>)[key].onClick
 state.account='account-b'; view.rerender(<QuestionNewV8 />)
 state.account='account-a'; view.rerender(<QuestionNewV8 />)
 await act(async () => { await handler({ defaultPrevented: false, preventDefault() {}, stopPropagation() {}, currentTarget: button, target: button }) })
 expect(state.update).not.toHaveBeenCalled()
})
it('取得した質問のアカウントが選択中と異なる場合は公開できない', async () => {
 state.get.mockResolvedValue({ success: true, data: { name: '質問', accountId: 'other-account', question: { text: 'よろしいですか', tapMode: 'single', choices: [{ key: 'yes', label: 'はい', behavior: 'none' }] }, usedBy: { scenarios: [{ id: 'scenario' }] }, publishedVersion: 1, draftRevision: 1 } })
 render(<QuestionNewV8 />)
 const button = await screen.findByRole('button', { name: '保存して公開' })
 expect(button.hasAttribute('disabled')).toBe(true)
 fireEvent.click(button)
 expect(state.update).not.toHaveBeenCalled()
})
