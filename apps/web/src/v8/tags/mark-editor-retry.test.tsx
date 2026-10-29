// @vitest-environment happy-dom
/*
 * 監査 WEB090：対応マークの編集で、初めの読み込みに失敗してやり直したら、
 * 入力欄に保存済みの名前を入れる（初期値「要確認」のまま保存させない）。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/tags/marks/edit',
}))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc', loading: false }) }))
const chrome = vi.hoisted(() => ({ title: vi.fn() }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: (...args: unknown[]) => chrome.title(...args), usePageCrumbs: () => undefined }))

const net = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      supportMarks: {
        ...actual.api.supportMarks,
        list: (...args: unknown[]) => net.list(...args),
        update: (...args: unknown[]) => net.update(...args),
        create: (...args: unknown[]) => net.create(...args),
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


test('409の比較だけでは入力と読んだ版を変えず、明示した取り込みで最新へ進む', async () => {
  net.list.mockReset().mockResolvedValue({ success: true, data: [{ id: 'mk1', name: '元の名前', color: '#2563D4', displayOrder: 0, isDefault: false, version: 1 }] })
  net.update.mockReset().mockRejectedValueOnce({ status: 409, code: 'SUPPORT_MARK_VERSION_CONFLICT', data: { latest: { name: 'ほかの人の名前', color: '#EF4B55', displayOrder: 4, version: 2 } } })
  render(<MarkEditor markId="mk1" />)
  const input = await screen.findByPlaceholderText('例：要確認') as HTMLInputElement
  await waitFor(() => expect(input.value).toBe('元の名前'))
  fireEvent.change(input, { target: { value: '自分の名前' } })
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  await screen.findByRole('button', { name: '違いを比べる' })
  expect(input.value).toBe('自分の名前')
  expect(net.update).toHaveBeenCalledWith('mk1', 'acc', expect.objectContaining({ expectedVersion: 1 }))
  fireEvent.change(input, { target: { value: '比較する前にも直した名前' } })
  fireEvent.click(screen.getByRole('button', { name: '違いを比べる' }))
  const dialog = await screen.findByRole('dialog', { name: '最新の保存と比べる' })
  expect(dialog.textContent).toContain('比較する前にも直した名前')
  expect(input.value).toBe('比較する前にも直した名前')
  fireEvent.click(within(dialog).getByRole('button', { name: '最新を読み込んで続ける' }))
  await waitFor(() => expect(input.value).toBe('ほかの人の名前'))
  net.update.mockResolvedValue({ success: true, data: { id: 'mk1', version: 3 } })
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  await waitFor(() => expect(net.update).toHaveBeenLastCalledWith('mk1', 'acc', expect.objectContaining({ expectedVersion: 2 })))
})
test('作る画面は題をトップバーへ渡し、名前・色・初期値を1回の作成で送る', async () => {
  net.list.mockReset().mockResolvedValue({ success: true, data: [{ id: 'mk1', name: '至急', color: '#d33', displayOrder: 0, isDefault: false }] })
  net.create.mockReset().mockResolvedValue({ success: true, data: { id: 'mk9' } })
  render(<MarkEditor />)
  const input = await screen.findByRole('textbox', { name: 'マーク名' }) as HTMLInputElement
  expect(chrome.title).toHaveBeenLastCalledWith('対応マークを作る')
  expect(screen.getByText('色')).toBeTruthy()
  fireEvent.change(input, { target: { value: '  折り返し待ち  ' } })
  fireEvent.click(screen.getByRole('switch', { name: '新しい友だちに最初から付ける' }))
  fireEvent.click(screen.getByRole('button', { name: '対応マークを作る' }))
  await waitFor(() => expect(net.create).toHaveBeenCalledTimes(1))
  expect(net.create).toHaveBeenCalledWith('acc', expect.objectContaining({ name: '折り返し待ち', color: expect.any(String), displayOrder: 1, isDefault: true }), expect.any(String))
})

test('編集画面の題は「対応マークを編集」', async () => {
  net.list.mockReset().mockResolvedValue({ success: true, data: [{ id: 'mk1', name: '至急', color: '#d33', displayOrder: 0, isDefault: false }] })
  render(<MarkEditor markId="mk1" />)
  await waitFor(() => expect((screen.getByPlaceholderText('例：要確認') as HTMLInputElement).value).toBe('至急'))
  expect(chrome.title).toHaveBeenLastCalledWith('対応マークを編集')
})
vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffRole: () => 'owner' }))
