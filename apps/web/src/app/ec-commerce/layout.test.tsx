// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  accountId: 'ec-account',
  style: 'ec',
  styleSelected: true,
  status: 'ready' as 'ready' | 'loading' | 'error',
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: fixture.replace }) }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: fixture.accountId }) }))
vi.mock('@/hooks/use-account-style', () => ({
  useAccountStyle: () => ({ data: fixture.status === 'ready' ? { style: fixture.style, styleSelected: fixture.styleSelected } : null, status: fixture.status, reload: vi.fn() }),
}))
vi.mock('@/components/shared/list-state', () => ({ default: ({ kind }: { kind: string }) => <div>{kind}</div> }))

import EcCommerceLayout from './layout'

beforeEach(() => {
  fixture.accountId = 'ec-account'
  fixture.style = 'ec'
  fixture.styleSelected = true
  fixture.status = 'ready'
  fixture.replace.mockClear()
})
afterEach(cleanup)

it('EC用途では画面を表示し、非ECへの切替中と切替後は表示せず設定へ戻す', async () => {
  const view = render(<EcCommerceLayout><span>ECの記録</span></EcCommerceLayout>)
  expect(view.queryByText('ECの記録')).toBeTruthy()

  fixture.accountId = 'other-account'
  fixture.status = 'loading'
  view.rerender(<EcCommerceLayout><span>ECの記録</span></EcCommerceLayout>)
  expect(view.queryByText('ECの記録')).toBeNull()

  fixture.style = 'standard'
  fixture.status = 'ready'
  view.rerender(<EcCommerceLayout><span>ECの記録</span></EcCommerceLayout>)
  expect(view.queryByText('ECの記録')).toBeNull()
  await waitFor(() => expect(fixture.replace).toHaveBeenCalledWith('/settings'))
})

it('ECを選びかけて未確定のアカウントは直接URLからも表示しない', async () => {
  fixture.styleSelected = false
  const view = render(<EcCommerceLayout><span>ECの記録</span></EcCommerceLayout>)
  expect(view.queryByText('ECの記録')).toBeNull()
  await waitFor(() => expect(fixture.replace).toHaveBeenCalledWith('/settings'))
})
