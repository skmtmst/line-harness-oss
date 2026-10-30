// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  replace: vi.fn(),
  accountId: 'account-1' as string | null,
  status: 'loading' as 'loading' | 'ready' | 'error',
  style: null as string | null,
  stale: false,
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: fixture.replace }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.accountId }) }))
vi.mock('@/hooks/use-account-style', () => ({
  useAccountStyle: () => ({ status: fixture.status, stale: fixture.stale, data: fixture.style ? { style: fixture.style } : null }),
}))

import RestaurantStyleGate from './restaurant-style-gate'

beforeEach(() => {
  fixture.replace.mockClear()
  fixture.accountId = 'account-1'
  fixture.status = 'loading'
  fixture.style = null
  fixture.stale = false
})
afterEach(cleanup)

it('飲食店のスタイルが確認できた時だけ設定画面を表示する', () => {
  const view = render(<RestaurantStyleGate><div>飲食店の設定</div></RestaurantStyleGate>)
  expect(view.queryByText('飲食店の設定')).toBeNull()
  fixture.status = 'ready'
  fixture.style = 'restaurant'
  view.rerender(<RestaurantStyleGate><div>飲食店の設定</div></RestaurantStyleGate>)
  expect(view.getByText('飲食店の設定')).toBeTruthy()
  expect(fixture.replace).not.toHaveBeenCalled()
})

it('飲食店以外で直接URLを開いた時は画面を隠して設定へ戻す', () => {
  fixture.status = 'ready'
  fixture.style = 'ec'
  const view = render(<RestaurantStyleGate><div>飲食店の設定</div></RestaurantStyleGate>)
  expect(view.queryByText('飲食店の設定')).toBeNull()
  expect(fixture.replace).toHaveBeenCalledWith('/settings')
})

it('古い記憶の飲食店スタイルでは画面を表示しない', () => {
  fixture.status = 'ready'
  fixture.style = 'restaurant'
  fixture.stale = true
  const view = render(<RestaurantStyleGate><div>飲食店の設定</div></RestaurantStyleGate>)
  expect(view.queryByText('飲食店の設定')).toBeNull()
  expect(fixture.replace).toHaveBeenCalledWith('/settings')
})
