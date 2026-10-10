// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ApprovalsTab from './approvals'

const items = vi.hoisted(() => [
  { eventId: 'new', friendName: '新しい成果', createdAt: '2026-10-08T00:00:00Z', approvalStatus: 'pending' },
  { eventId: 'old', friendName: '古い成果', createdAt: '2026-10-01T00:00:00Z', approvalStatus: 'pending' },
])
vi.mock('@/lib/api', () => ({ api: { conversionApprovals: { holdDays: async () => ({ success: true, data: {} }) } } }))
vi.mock('./display', async (original) => ({
  ...await original<typeof import('./display')>(),
  listAllConversionApprovals: async (status: string) => ({ items: items.filter(i => i.approvalStatus === status), truncated: false }),
}))
afterEach(cleanup)
it('WEB-002：承認待ちの成果は古い順に表示する', async () => {
  render(<ApprovalsTab />)
  await waitFor(() => expect(screen.getByText('古い成果')).toBeTruthy())
  const names = [...document.querySelectorAll('tbody tr')].map(row => row.textContent)
  expect(names[0]).toContain('古い成果')
  expect(names[1]).toContain('新しい成果')
})
