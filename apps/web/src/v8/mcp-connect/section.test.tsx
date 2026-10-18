// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/*
 * G9 AI とつなぐの区画の動き（要件 MCP-01・02・15・18・19）：
 * 作るのはオーナーだけ・管理者は「オーナーだけが作れます」で止めるはできる・閲覧のみは見るだけ・スタッフには出さない・
 * 鍵は 1 回だけで、閉じる前に「鍵はもう見られません」の確かめ。
 */
const role = vi.hoisted(() => ({ value: 'owner' as string | null }))
const apiMock = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), stop: vi.fn(), rotate: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: { id: 'acc-1', name: '渋谷店' }, accounts: [{ id: 'acc-1', name: '渋谷店' }] }) }))
vi.mock('@/lib/staff-role', () => ({ useStaffIdentity: () => null, useStaffRole: () => role.value }))
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, mcpApi: { ...actual.mcpApi, ...apiMock } }
})
import McpConnectionsSection from './section'

const CONNECTION = { id: 'mcp-1', name: 'Claude（Kenta）', level: 'draft', accounts: [{ id: 'acc-1', name: '渋谷店' }], keyPrefix: 'mcp_', expiresAt: '2027-01-15T00:00:00.000Z', lastUsedAt: null, status: 'active', previousKeyExpiresAt: null, version: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  role.value = 'owner'
  apiMock.list.mockResolvedValue({ success: true, data: [CONNECTION] })
  apiMock.create.mockResolvedValue({ success: true, data: { connection: { ...CONNECTION, id: 'mcp-2', level: 'read' }, url: 'https://api.example.test/mcp/acc', key: 'mcp_live_abcdef1234567890' } })
})
afterEach(cleanup)

async function open() {
  render(<McpConnectionsSection />)
  await act(async () => {})
}

it('オーナーは接続を作れ、鍵は 1 回だけ出て、閉じる前に確かめる', async () => {
  await open()
  expect(screen.getByText('読む＋下書きを作る')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '接続を作る' }))
  const dialog = screen.getByRole('dialog')
  for (const word of ['読むだけ', '読む＋下書きを作る', '読む＋下書き＋送る依頼']) expect(within(dialog).getByText(word)).toBeTruthy()
  fireEvent.change(within(dialog).getByLabelText(/名前/), { target: { value: 'Claude（Kenta）' } })
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: '作る' })) })
  expect(apiMock.create).toHaveBeenCalledWith({ name: 'Claude（Kenta）', level: 'read', accountIds: ['acc-1'], expiresInDays: 90 }, undefined)
  expect(screen.getByText('接続を作りました')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  expect(screen.getByText(/鍵はもう見られません/)).toBeTruthy()
})

it('管理者には作るボタンを出さず「オーナーだけが作れます」、止めるはできる', async () => {
  role.value = 'admin'
  await open()
  expect(screen.queryByRole('button', { name: '接続を作る' })).toBeNull()
  expect(screen.getByText('オーナーだけが作れます')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '「Claude（Kenta）」の操作' }))
  expect(screen.getByRole('menuitem', { name: '止める' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: '鍵を作り直す' })).toBeNull()
})

it('閲覧のみは見るだけ（作る・止める・作り直すを出さない）、スタッフには区画を出さない', async () => {
  role.value = 'viewer'
  await open()
  expect(screen.getByText('Claude（Kenta）')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '接続を作る' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '「Claude（Kenta）」の操作' }))
  expect(screen.queryByRole('menuitem', { name: '止める' })).toBeNull()
  cleanup()
  role.value = 'staff'
  await open()
  expect(screen.queryByText('AI とつなぐ（MCP）')).toBeNull()
  expect(apiMock.list).toHaveBeenCalledTimes(1)
})
