// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const create = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account', loading: false }) }))
vi.mock('@/components/automations/use-common-action-permission', () => ({ useCanManageCommonActions: () => true }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, commonActions: {
    ...actual.api.commonActions, create,
    resources: vi.fn().mockResolvedValue({ success: true, data: { tags: [], scenarios: [], templates: [], webhooks: [], richMenus: [], commonActions: [] } }),
  } } }
})

import { CommonActionNew } from './common-action-new'

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('空の名前では欄の下だけに理由を出してフォーカスし、通信しない', async () => {
  render(<CommonActionNew />)
  await waitFor(() => expect((screen.getByRole('button', { name: '下書きを保存' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  const name = screen.getByLabelText('名前')
  expect(document.activeElement).toBe(name)
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(screen.getAllByText('共通アクション名を入力してください')).toHaveLength(1)
  expect(create).not.toHaveBeenCalled()
  fireEvent.change(name, { target: { value: '購入のお礼' } })
  expect(name.getAttribute('aria-invalid')).not.toBe('true')
  expect(screen.queryByText('共通アクション名を入力してください')).toBeNull()
})

it('閉じた行でも並べ替え・削除でき、保存する処理の順番に反映する', async () => {
  create.mockResolvedValue({ success: true, data: { id: 'new-action' } })
  render(<CommonActionNew />)
  await waitFor(() => expect((screen.getByRole('button', { name: '下書きを保存' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.change(screen.getByLabelText('名前'), { target: { value: '購入のお礼' } })
  fireEvent.click(screen.getByRole('button', { name: '待ち時間を入れる' }))
  fireEvent.click(screen.getByRole('button', { name: '2番目の処理を上へ' }))
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  expect(create.mock.calls[0][1].actions.map((step: { type: string }) => step.type)).toEqual(['wait', 'add_tag'])
  await waitFor(() => expect((screen.getByRole('button', { name: '下書きを保存' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '2番目の処理を削除' }))
  fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
  expect(create.mock.calls[1][1].actions.map((step: { type: string }) => step.type)).toEqual(['wait'])
})
