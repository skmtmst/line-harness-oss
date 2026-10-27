// @vitest-environment happy-dom
/*
 * ウェビナー作成（板 j7PP04）の段と入力は共通部品で描く。
 * 段の余白（共通の card-content-padding）と入力の高さ・角（radius-control）は
 * 共通部品の側の試験（card-content-padding.test.tsx・control-dimensions-contract.test.ts）と
 * v8-guard の崩れの見張りが持つので、ここでは「共通部品を使っているか」を描いて見る。
 */
import { rememberStaffIdentity, forgetStaffIdentity } from '@/lib/staff-identity-state'
import type { StaffMember } from '@line-crm/shared'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  usePathname: () => '/webinars/new',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, accounts: [], loading: false }) }))

import NewWebinarPage from './new/page'

beforeEach(() => {
  forgetStaffIdentity(); rememberStaffIdentity({ role: 'owner' } as StaffMember)
  document.documentElement.dataset.theme = 'v8'
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme') })

test('基本設定の段は共通のカード、名前の欄は共通の入力で描く', async () => {
  render(<NewWebinarPage />)
  const heading = await screen.findByText('基本設定', { selector: 'h2, h3, [id]' })
  const card = heading.closest('[data-design-part="card"]')
  expect(card).not.toBeNull()
  expect(card?.getAttribute('data-card-variant')).toBe('form')
  const name = screen.getByLabelText(/^名前/) as HTMLInputElement
  expect(card?.contains(name)).toBe(true)
  expect(name.closest('[data-design-node="Ume2U"]') ?? name.closest('[data-design-node="i5BW8b"]')).not.toBeNull()
})
