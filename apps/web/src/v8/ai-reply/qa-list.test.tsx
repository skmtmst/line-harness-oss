// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/*
 * G2 Q&A タブの動き（要件 AI-02・07・08・20・23）：
 * 自動で答えるのオンはオーナーだけ・確かめの窓（NmTj4）を通す・閲覧のみは隠す・読めないときは読み直しの押し口。
 */
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const apiMock = vi.hoisted(() => ({
  settings: vi.fn(), saveSettings: vi.fn(), listQa: vi.fn(), test: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/auto-replies' }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: { id: 'acc-1', name: '渋谷店' }, accounts: [] }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/lib/staff-role', () => ({ useStaffIdentity: () => null, useStaffRole: () => role.value }))
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, aiReplyApi: { ...actual.aiReplyApi, ...apiMock } }
})
import QaListV8 from './qa-list'

const QA = { id: 'qa-1', questions: ['駐車場はありますか'], answerText: '店の裏に 3 台あります。', status: 'published', source: 'manual', useCount: 31, version: 1, updatedAt: '2026-10-01T00:00:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
  role.value = 'owner'
  apiMock.settings.mockResolvedValue({ success: true, data: { mode: 'draft_only', suspendedReason: null, publishedQaCount: 18, draftQaCount: 1, version: 4 } })
  apiMock.saveSettings.mockResolvedValue({ success: true, data: { mode: 'auto_qa', suspendedReason: null, publishedQaCount: 18, draftQaCount: 1, version: 5 } })
  apiMock.listQa.mockResolvedValue({ success: true, data: { items: [QA], total: 1 } })
})
afterEach(cleanup)

async function open() {
  render(<QaListV8 />)
  await act(async () => {})
}

it('オーナーが自動で答えるを選ぶと確かめの窓が開き、窓で押すまで段は変わらない', async () => {
  await open()
  fireEvent.click(screen.getByRole('button', { name: '変える' }))
  fireEvent.click(screen.getByRole('button', { name: '自動で答える' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText('自動で答える前の確かめ')).toBeTruthy()
  expect(within(dialog).getByText(/公開中の Q&A 18 件/)).toBeTruthy()
  expect(within(dialog).getByText('自動で送った答えは取り消せません。')).toBeTruthy()
  expect(apiMock.saveSettings).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /自動で答えるをオンにする/ })) })
  expect(apiMock.saveSettings).toHaveBeenCalledWith('acc-1', { mode: 'auto_qa', expectedVersion: 4 }, undefined)
})

it('管理者には自動で答えるの選択肢を出さない（オーナーだけ）', async () => {
  role.value = 'admin'
  await open()
  fireEvent.click(screen.getByRole('button', { name: '変える' }))
  expect(screen.queryByRole('button', { name: '自動で答える' })).toBeNull()
  expect(screen.getByText('自動で答えるのオンはオーナーだけが変えられます')).toBeTruthy()
})

it('閲覧のみには追加・取り込み・変える・行の「…」を出さず、帯を出す', async () => {
  role.value = 'viewer'
  await open()
  expect(screen.getByText(/閲覧のみで見ています。Q&A の追加/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Q&A を追加/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /取り込む/ })).toBeNull()
  expect(screen.queryByRole('button', { name: '変える' })).toBeNull()
  expect(screen.queryByRole('button', { name: '「駐車場はありますか」の操作' })).toBeNull()
  expect(screen.getByText('駐車場はありますか')).toBeTruthy()
})

it('一覧を読めないときは読み直しの押し口を出し、押すと読み直す', async () => {
  apiMock.listQa.mockRejectedValueOnce(new Error('network'))
  await open()
  expect(screen.getByText('読み込めませんでした')).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /もう一度/ })) })
  expect(apiMock.listQa).toHaveBeenCalledTimes(2)
  expect(screen.getByText('駐車場はありますか')).toBeTruthy()
})
