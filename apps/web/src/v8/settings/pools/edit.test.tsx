// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), role: 'owner' }))
vi.mock('@/lib/api', async (load) => {
  const actual = await load<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, pools: { ...actual.api.pools, list: net.list, update: net.update, accounts: { list: async () => ({ success: true, data: [] }) } }, lineAccounts: { list: async () => ({ success: true, data: [] }) } } }
})
vi.mock('@/lib/pools-availability', () => ({ isPoolsFeatureAvailable: async () => true }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => net.role }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
import PoolsV8 from './pools'

beforeEach(() => {
  net.role = 'owner'
  net.list.mockReset().mockResolvedValue({ success: true, data: [{ id: 'pool', name: '店への入り口', slug: 'main' }] })
  net.update.mockReset().mockRejectedValue(new Error('offline'))
})
afterEach(cleanup)

it('既定プールも名前を編集でき、空欄は送らず、失敗しても入力を残す', async () => {
  render(<PoolsV8 />)
  fireEvent.click(await screen.findByRole('button', { name: '店への入り口の操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '編集する' }))
  const input = screen.getByRole('textbox', { name: /プール名/ }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '保存する', exact: true }))
  expect(net.update).not.toHaveBeenCalled()
  expect(screen.getByText('名前を入力してください')).toBeTruthy()
  fireEvent.change(input, { target: { value: '  新しい名前  ' } })
  fireEvent.click(screen.getByRole('button', { name: '保存する', exact: true }))
  await waitFor(() => expect(net.update).toHaveBeenCalledWith('pool', { name: '新しい名前' }))
  await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('入力は残っています'))
  expect(input.value).toBe('  新しい名前  ')
})

it('編集中に閉じると破棄を確認し、キャンセルでは入力を残す', async () => {
  render(<PoolsV8 />)
  fireEvent.click(await screen.findByRole('button', { name: '店への入り口の操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '編集する' }))
  fireEvent.change(screen.getByRole('textbox', { name: /プール名/ }), { target: { value: '入力途中' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'キャンセル', exact: true }))
  const confirm = screen.getByRole('dialog', { name: '入力を破棄しますか？' })
  fireEvent.click(within(confirm).getByRole('button', { name: '編集を続ける', exact: true }))
  expect((screen.getByRole('textbox', { name: /プール名/ }) as HTMLInputElement).value).toBe('入力途中')
  expect(net.update).not.toHaveBeenCalled()
})

it('閲覧のみと管理者には編集の口を出さない（APIはオーナー専用）', async () => {
  net.role = 'admin'
  render(<PoolsV8 />)
  await screen.findByText('店への入り口')
  expect(screen.queryByRole('button', { name: '店への入り口の操作' })).toBeNull()
})
