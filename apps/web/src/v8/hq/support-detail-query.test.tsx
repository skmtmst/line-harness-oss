// @vitest-environment happy-dom
/*
 * 監査 WEB212：同じ画面のまま別の問い合わせ（?id=）へ移ったら作り直す。前の問い合わせと書きかけを残さない。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const nav = vi.hoisted(() => ({ id: 'req-a' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`id=${nav.id}`),
  usePathname: () => '/hq/support/detail',
}))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/components/shell/page-chrome', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shell/page-chrome')>()
  return { ...actual, usePageTitle: () => undefined, usePageCrumbs: () => undefined }
})
const request = vi.hoisted(() => (id: string, subject: string) => ({
  id, subject, status: 'open', kind: 'question', kindLabel: null, ticketLabel: `#${id}`, lineAccountId: null,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', stageLabel: '', messages: [], canFollowUp: true,
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      hqSupport: {
        ...actual.api.hqSupport,
        detail: async (id: string) => ({ success: true, data: request(id, id === 'req-a' ? '請求書について' : 'ログインについて') }),
        list: async () => ({ success: true, data: [] }),
        context: async () => ({ success: true, data: { accounts: [] } }),
      },
      staff: { ...actual.api.staff, me: async () => ({ success: true, data: { id: 's', email: 'a@example.com', name: '担当' } }) },
      tenants: { ...actual.api.tenants, me: async () => ({ success: true, data: { name: '本部' } }) },
    },
  }
})

import HqSupportDetailV8 from './support-detail'
afterEach(cleanup)

test('別の問い合わせへ移ると、その問い合わせを出し、書きかけを残さない', async () => {
  const view = render(<HqSupportDetailV8 />)
  await screen.findAllByText('請求書について')
  const box = document.querySelector('textarea') as HTMLTextAreaElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'Aへの続き')
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  nav.id = 'req-b'
  view.rerender(<HqSupportDetailV8 />)
  await waitFor(() => expect(screen.getAllByText('ログインについて').length).toBeGreaterThan(0))
  expect(screen.queryByText('請求書について')).toBeNull()
  expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
})
