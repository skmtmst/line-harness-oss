// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get: vi.fn(), theme: 'v8' }))
vi.mock('@/lib/api', () => ({ api: { friendStats: { get: mocks.get } } }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a' }) }))
vi.mock('@/lib/use-admin-theme', () => ({ useAdminTheme: () => mocks.theme }))
import FriendKpis from './friend-kpis'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
it('APIの前月差を表示し、記録なしを0で埋めない', async () => {
 const host = document.createElement('div'), root = createRoot(host)
 try {
  mocks.get.mockResolvedValue({ success: true, data: { active: 7, total: 8, blockedByThem: 1, hiddenByUs: 0, unanswered: 0, resolved: 0, addedThisMonth: 1, addedLastMonth: 2, activeLastMonth: 5, activeMonthDelta: 2 } })
  await act(async () => { root.render(<FriendKpis />) })
  expect(host.textContent).toContain('前月末 5人（+2）')
  await act(async () => { root.unmount() })
 } finally { host.remove() }
})
