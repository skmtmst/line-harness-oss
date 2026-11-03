// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const removeAccount = vi.hoisted(() => vi.fn())

vi.mock('@/lib/staff-role', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/staff-role')>()), useStaffRole: () => 'owner' }))
vi.mock('@/components/shell/page-chrome', async () => (await import('@/test-utils/page-chrome-mock')).pageChromeMock())
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/lib/pools-availability', () => ({ isPoolsFeatureAvailable: () => true }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1' }) }))
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      pools: {
        ...actual.api.pools,
        list: async () => ({ success: true, data: [{ id: 'p1', name: '既定', slug: 'main', isMain: true }] }),
        accounts: { list: async () => ({ success: true, data: [{ id: 'member-1', lineAccountId: 'acc-1' }] }), remove: removeAccount },
      },
      lineAccounts: { ...actual.api.lineAccounts, list: async () => ({ success: true, data: [{ id: 'acc-1', name: '本店' }] }) },
    },
  }
})
import PoolsV8 from './pools'

afterEach(cleanup)

// 決まり2: 外した時の説明は帯にせず、題の横の「？」へ入れる。
it('プールから外れた時の説明は帯に出さず題の「？」に入れる', async () => {
  render(<PoolsV8 />)
  await screen.findByText('既定')
  expect(screen.queryByText(/振り分けられなくなります/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'この画面の説明' }))
  expect(await screen.findByText(/振り分けられなくなります/)).toBeTruthy()
})

it('所属から外す確認には対象のアカウントと環境を出す', async () => {
  render(<PoolsV8 />)
  fireEvent.click(await screen.findByRole('button', { name: '外す' }))
  const dialog = screen.getByRole('dialog')
  expect(dialog.textContent).toContain('LINEアカウント')
  expect(dialog.textContent).toContain('本店')
  expect(dialog.textContent).toContain('環境')
})

it('所属から外す窓を再表示した後は古い確定を受け付けない', async () => {
  removeAccount.mockClear(); removeAccount.mockResolvedValue({ success: true })
  render(<PoolsV8 />)
  fireEvent.click(await screen.findByRole('button', { name: '外す' }))
  const button = within(screen.getByRole('dialog')).getByRole('button', { name: '外す' })
  const key = Object.keys(button).find(name => name.startsWith('__reactProps$'))!
  const oldClick = (button as unknown as Record<string, { onClick: () => void }>)[key].onClick
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'キャンセル' }))
  fireEvent.click(screen.getByRole('button', { name: '外す' }))
  await act(async () => { oldClick() })
  expect(removeAccount).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '外す' }))
  expect(removeAccount).toHaveBeenCalledWith('p1', 'member-1')
})
