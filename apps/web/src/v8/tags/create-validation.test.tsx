// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const net = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/tags/new' }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc' }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined, usePageCrumbs: () => undefined }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'admin', canManageRole: () => true }))
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: () => ({ disarm: vi.fn(), dialogOpen: false }) }))
vi.mock('@/lib/unsaved-leave-dialog', () => ({ UnsavedLeaveDialog: () => null }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }), createDefinition: net.create }, tagGroups: { ...actual.api.tagGroups, list: async () => ({ success: true, data: [] }) } } }
})
import TagCreate from './create'
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('未入力で保存すると名前欄に理由を一度だけ出し、そこへ移動して送信を止める', async () => {
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
  render(<TagCreate />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'タグを作る', exact: true })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'タグを作る', exact: true }))
  const input = screen.getByLabelText('タグ名')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(input)
  expect(scroll).toHaveBeenCalledWith({ block: 'center' })
  expect(screen.getAllByText('タグ名を入力してください')).toHaveLength(1)
  expect(net.create).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: '定期購入者' } })
  expect(input.getAttribute('aria-invalid')).not.toBe('true')
  scroll.mockRestore()
})

test('保存APIの422を名前欄の下に出し、最初の欄へ移り、打ち直すと消す', async () => {
  const { ApiError } = await import('@/lib/api')
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => setTimeout(() => run(0), 0))
  net.create.mockRejectedValueOnce(new ApiError(422, '入力を確認してください', undefined, undefined, undefined, undefined, { name: 'このタグ名は使われています' }))
  render(<TagCreate />)
  const save = await screen.findByRole('button', { name: 'タグを作る', exact: true })
  const input = screen.getByLabelText('タグ名')
  fireEvent.change(input, { target: { value: '既存タグ' } })
  fireEvent.click(save)
  await waitFor(() => expect(screen.getByText('このタグ名は使われています')).toBeTruthy())
  await waitFor(() => expect(document.activeElement).toBe(input))
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(input.getAttribute('aria-describedby')).toContain(screen.getByText('このタグ名は使われています').id)
  expect(screen.queryByText('入力を確認してください')).toBeNull()
  expect(net.create).toHaveBeenCalledTimes(1)
  fireEvent.change(input, { target: { value: '別のタグ名' } })
  expect(screen.queryByText('このタグ名は使われています')).toBeNull()
  scroll.mockRestore()
  vi.unstubAllGlobals()
})
