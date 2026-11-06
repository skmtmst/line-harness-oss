import React from 'react'
import { PageExplanationProvider } from '@/components/shared/page-explanation'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { FieldsTab } from '@/v8/tags/public/fields-tab/index'

const fixture = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffIdentity: () => null }))
vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error { constructor(message: string, readonly status: number) { super(message) } },
  api: { friendFields: { stats: () => fixture.load(), list: async () => ({ success: true, data: [] }) }, folders: { list: async () => ({ success: true, data: [] }) } },
}))
vi.mock('@/components/shared/kpi-card', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/kpi-card')>()
  return { ...actual, default: (props: React.ComponentProps<typeof actual.default>) =>
    React.createElement(actual.default, process.env.L2X_KPI_FAULT === '1' ? { ...props, detail: '', value: 0 } : props) }
})
export const stats = fixture
beforeEach(() => { fixture.load.mockReset() })
afterEach(cleanup)

export function drawFields() {
  const { container } = render(<PageExplanationProvider pageKey="tags:fields"><FieldsTab accountId="account-test" canEdit={false} /></PageExplanationProvider>)
  const details = () => [...container.querySelectorAll('[data-kpi-detail]')].map(el => el.textContent)
  const numbers = () => [...container.querySelectorAll('[data-kpi-number]')].map(el => el.textContent)
  return { container, details, numbers, waitFor }
}
