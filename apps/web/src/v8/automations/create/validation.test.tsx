// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const createDraft = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account' }) }))
vi.mock('@/components/automations/use-common-action-permission', () => ({ useCanManageCommonActions: () => true }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, automations: {
    ...actual.api.automations,
    createDraftFromTemplate: createDraft,
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    draftResources: vi.fn().mockResolvedValue({ success: true, data: { tags: [{ id: 'tag', name: '予約希望' }], scenarios: [], commonActions: [] } }),
  } } }
})

import { NewAutomationV8 } from './create'

beforeEach(() => {
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/automations/new')
  vi.stubGlobal('sessionStorage', window.sessionStorage)
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('名前の誤りは欄だけに出し、処理の誤りは設定を開いて選ぶ欄へ移る', async () => {
  render(<NewAutomationV8 />)
  const save = screen.getByRole('button', { name: '下書きを保存' })
  fireEvent.click(save)
  const name = screen.getByRole('textbox', { name: '名前', exact: true })
  await waitFor(() => expect(document.activeElement).toBe(name))
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getAllByText('ルール名を入力してください')).toHaveLength(1)
  expect(createDraft).not.toHaveBeenCalled()

  fireEvent.change(name, { target: { value: '予約のお礼' } })
  fireEvent.click(save)
  const tag = await screen.findByRole('button', { name: '自動化で付けるタグ' })
  await waitFor(() => expect(document.activeElement).toBe(tag))
  expect(tag.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getAllByText('付けるタグを選んでください')).toHaveLength(1)
  expect(createDraft).not.toHaveBeenCalled()
})
