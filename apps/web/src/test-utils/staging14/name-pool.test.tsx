// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), role: 'owner' }))
vi.mock('@/lib/api', async (load) => {
  const actual = await load<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, pools: { ...actual.api.pools, list: net.list, get: net.get, update: net.update, accounts: { list: async () => ({ success: true, data: [] }) } }, lineAccounts: { list: async () => ({ success: true, data: [] }) } } }
})
vi.mock('@/lib/pools-availability', () => ({ isPoolsFeatureAvailable: async () => true }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => net.role }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/components/layout/settings-inner-nav', () => ({ default: () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
import PoolsV8 from '../../v8/settings/pools/pools'

beforeEach(() => {
  net.role = 'owner'
  net.list.mockReset().mockResolvedValue({ success: true, data: [{ id: 'pool', name: '店への入り口', slug: 'main', updatedAt: '2026-10-10T00:00:00.000+09:00' }] })
  net.get.mockReset().mockResolvedValue({ success: true, data: { id: 'pool', name: '相手の名前', updatedAt: '2026-10-10T00:00:01.000+09:00' } })
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
  await waitFor(() => expect(net.update).toHaveBeenCalledWith('pool', { name: '新しい名前', expectedUpdatedAt: '2026-10-10T00:00:00.000+09:00' }))
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

it('staffにはプール変更操作を出さない', async () => {
  net.role = 'staff'; render(<PoolsV8 />); await screen.findByText('店への入り口');
  expect(screen.queryByRole('button', { name: '店への入り口の操作' })).toBeNull();
});
it('保存成功は入力を一度だけ送り再取得する', async () => {
  net.update.mockResolvedValue({success:true}); render(<PoolsV8 />);
  fireEvent.click(await screen.findByRole('button',{name:'店への入り口の操作'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'編集する'}));
  fireEvent.change(screen.getByRole('textbox',{name:/プール名/}),{target:{value:'新しい名前'}});
  fireEvent.click(screen.getByRole('button',{name:'保存する',exact:true}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  expect(net.update).toHaveBeenCalledTimes(1); expect(net.list.mock.calls.length).toBeGreaterThan(1);
});
it('409は入力を保ち違いを比べる操作を出す', async () => {
  net.update.mockRejectedValue(Object.assign(new Error('conflict'),{status:409})); render(<PoolsV8 />);
  fireEvent.click(await screen.findByRole('button',{name:'店への入り口の操作'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'編集する'}));
  fireEvent.change(screen.getByRole('textbox',{name:/プール名/}),{target:{value:'入力途中'}});
  fireEvent.click(screen.getByRole('button',{name:'保存する',exact:true}));
  await screen.findByText(/入力は残っています/);
  expect((screen.getByRole('textbox',{name:/プール名/}) as HTMLInputElement).value).toBe('入力途中');
  expect(screen.queryByRole('button',{name:'違いを比べる'})).not.toBeNull();
});

it('409の比較は下書きを変えず、読み直してから新しい保存版で保存する', async () => {
 net.update.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 })).mockResolvedValue({ success: true })
 render(<PoolsV8 />)
 fireEvent.click(await screen.findByRole('button', { name: '店への入り口の操作' }))
 fireEvent.click(screen.getByRole('menuitem', { name: '編集する' }))
 const input = screen.getByRole('textbox', { name: /プール名/ }) as HTMLInputElement
 fireEvent.change(input, { target: { value: '自分の下書き' } })
 fireEvent.click(screen.getByRole('button', { name: '保存する', exact: true }))
 fireEvent.click(await screen.findByRole('button', { name: '違いを比べる' }))
 const compare = await screen.findByRole('dialog', { name: '最新の保存と比べる' })
 expect(compare.textContent).toContain('自分の下書き'); expect(compare.textContent).toContain('相手の名前')
 expect(input.value).toBe('自分の下書き'); expect(net.update).toHaveBeenCalledTimes(1)
 fireEvent.click(within(compare).getByRole('button', { name: '最新を読み込んで続ける' }))
 await waitFor(() => expect(input.value).toBe('相手の名前'))
 fireEvent.change(input, { target: { value: '合意した名前' } })
 fireEvent.click(screen.getByRole('button', { name: '保存する', exact: true }))
 await waitFor(() => expect(net.update).toHaveBeenLastCalledWith('pool', { name: '合意した名前', expectedUpdatedAt: '2026-10-10T00:00:01.000+09:00' }))
})
it('競合後の最新取得が失敗しても下書きと保存の停止を保つ', async () => {
 net.update.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 })); net.get.mockRejectedValue(new Error('offline'))
 render(<PoolsV8 />)
 fireEvent.click(await screen.findByRole('button', { name: '店への入り口の操作' })); fireEvent.click(screen.getByRole('menuitem', { name: '編集する' }))
 const input = screen.getByRole('textbox', { name: /プール名/ }) as HTMLInputElement
 fireEvent.change(input, { target: { value: '残す下書き' } }); fireEvent.click(screen.getByRole('button', { name: '保存する', exact: true }))
 fireEvent.click(await screen.findByRole('button', { name: '最新を読み込んで続ける' }))
 await screen.findByText(/最新のプールを読み込めませんでした/)
 expect(input.value).toBe('残す下書き'); expect(net.update).toHaveBeenCalledTimes(1)
 expect(screen.queryByRole('button', { name: '保存する', exact: true })).toBeNull()
})
