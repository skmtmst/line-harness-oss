// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ staffId: 'staff-a', requests: [] as string[] }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, staff: { ...actual.api.staff, me: async () => ({ success: true, data: { id: fixture.staffId, role: 'staff' } }) } },
    fetchApi: async (path: string) => { fixture.requests.push(path); return { success: true, data: { items: [], summary: { total: 30, line: 30, email: 0, emailUnread: 0, oldestWaitMinutes: 1 } } } },
  }
})
import PendingInboxCard from './pending-inbox-card'
beforeEach(() => { fixture.requests = []; fixture.staffId = 'staff-a'; window.localStorage.clear() })
afterEach(cleanup)
it('本人APIのIDごとに保存した件数を復元し、同じ端末の別の担当者へ混ぜない', async () => {
  window.localStorage.setItem('lh_pending_inbox_page_size:staff-a', '10')
  window.localStorage.setItem('lh_pending_inbox_page_size:staff-b', '20')
  render(<PendingInboxCard />)
  await waitFor(() => expect(fixture.requests.some(path => path.includes('limit=10'))).toBe(true))
  cleanup()
  fixture.staffId = 'staff-b'; fixture.requests = []
  render(<PendingInboxCard />)
  await waitFor(() => expect(fixture.requests.some(path => path.includes('limit=20'))).toBe(true))
  expect(fixture.requests.some(path => path.includes('limit=10'))).toBe(false)
})
