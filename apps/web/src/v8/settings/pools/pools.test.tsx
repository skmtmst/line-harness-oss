// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

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
        accounts: { list: async () => ({ success: true, data: [] }) },
      },
      lineAccounts: { ...actual.api.lineAccounts, list: async () => ({ success: true, data: [] }) },
    },
  }
})
import PoolsV8 from './pools'

afterEach(cleanup)

// 決まり2: 外した時の説明は帯にせず、題の横の「？」へ入れる。
it('外した時の説明は帯に出さず題の「？」に入れる', async () => {
  render(<PoolsV8 />)
  await screen.findByText('既定')
  expect(screen.queryByText(/振り分けられなくなります/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'この画面の説明' }))
  expect(await screen.findByText(/振り分けられなくなります/)).toBeTruthy()
})
