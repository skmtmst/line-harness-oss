// @vitest-environment happy-dom
/*
 * 監査 WEB090：対応マークの編集で、初めの読み込みに失敗してやり直したら、
 * 入力欄に保存済みの名前を入れる（初期値「要確認」のまま保存させない）。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/tags/marks/edit',
}))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc', loading: false }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))

const net = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      supportMarks: {
        ...actual.api.supportMarks,
        list: (...args: unknown[]) => net.list(...args),
        automationRules: async () => ({ success: true, data: [] }),
      },
    },
  }
})

import MarkEditor from './mark-editor'
afterEach(cleanup)

test('初めの読み込みに失敗してやり直したら、保存済みの名前が入る', async () => {
  net.list
    .mockRejectedValueOnce(new Error('down'))
    .mockResolvedValue({ success: true, data: [{ id: 'mk1', name: '至急', color: '#d33', displayOrder: 0, isDefault: false }] })
  render(<MarkEditor markId="mk1" />)
  const retry = await screen.findByRole('button', { name: /もう一度/ })
  await act(async () => { retry.click() })
  await waitFor(() => expect((screen.getByPlaceholderText('例：要確認') as HTMLInputElement).value).toBe('至急'))
})
