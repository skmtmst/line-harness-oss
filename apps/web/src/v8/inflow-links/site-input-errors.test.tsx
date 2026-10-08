// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const create = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: {
    staff: { me: async () => ({ success: true, data: { role: 'owner' } }) },
    siteTracking: {
      pages: async () => ({ success: true, data: [] }),
      summary: async () => ({ success: true, data: null }),
      trackingKey: async () => ({ success: true, data: { trackingKey: 'test-key' } }),
    },
    measurementSites: { list: async () => ({ success: true, data: [] }), create },
  } }
})
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', async (original) => ({
  ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner',
}))
import { ApiError } from '@/lib/api'
import SiteScript from './site-script'

afterEach(cleanup)
it('サイトの不足欄とサーバーが断ったドメインは、欄で一度だけ知らせて移動する', async () => {
  create.mockReset()
  render(<SiteScript />)
  fireEvent.click(await screen.findByRole('button', { name: 'サイトを追加する' }))
  const dialog = within(screen.getByRole('dialog', { name: '計測サイトを追加' }))
  const name = dialog.getByLabelText('サイトの名前')
  const domain = dialog.getByLabelText('計測を許可するドメイン')
  const scroll = vi.fn()
  name.scrollIntoView = scroll
  fireEvent.click(screen.getByRole('button', { name: '追加する', exact: true }))
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(name)
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  expect(create).not.toHaveBeenCalled()

  fireEvent.change(name, { target: { value: '公式ショップ' } })
  fireEvent.change(domain, { target: { value: 'invalid-domain' } })
  create.mockRejectedValueOnce(new ApiError(400, '計測を許可するドメインを1つ以上入れてください'))
  domain.scrollIntoView = scroll
  fireEvent.click(screen.getByRole('button', { name: '追加する', exact: true }))
  await waitFor(() => expect(domain.getAttribute('aria-invalid')).toBe('true'))
  await waitFor(() => expect(document.activeElement).toBe(domain))
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(screen.getByRole('alert').id).toBe(domain.getAttribute('aria-describedby'))
})
