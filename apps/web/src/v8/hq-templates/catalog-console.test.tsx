// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CatalogConsole from './catalog-console'
const calls = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), detail: vi.fn(), redistributionPreview: vi.fn(), redistribute: vi.fn(), accounts: vi.fn(), picker: vi.fn() }))
vi.mock('@/lib/api/helpers/hq-catalog-templates', () => ({ hqCatalogTemplatesApi: calls }))
vi.mock('@/lib/hq-templates-api', () => ({ hqTemplatesApi: { accounts: calls.accounts } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner', canManageRole: () => true }))
vi.mock('@/components/shared/list-navigation', () => ({ useListNavigationRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => '/hq/templates', useSearchParams: () => new URLSearchParams() }))
vi.mock('./account-picker', () => ({ default: (props: { onChange: (ids: string[]) => void; disabledIds: string[] }) => { calls.picker(props); return <button onClick={() => props.onChange(['a'])}>店を選ぶ</button> } }))
beforeEach(() => { calls.list.mockResolvedValue({ data: [] }); calls.accounts.mockResolvedValue([{ id: 'a', name: '本店' }]) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
it.each(['booking_menu','mileage_reward'] as const)('%s のひな形を保存する', async type => {
  calls.create.mockImplementation(async (input) => ({ data: { template: { id:'t', template_type:type, revision:1, name:input.name }, definition: input.definition } }))
  render(<CatalogConsole type={type} />)
  fireEvent.click(await screen.findByRole('button', { name:'ひな形を作る' }))
  fireEvent.change(screen.getByLabelText('統括での名前'), { target: { value:'本部のひな形' } })
  fireEvent.change(screen.getByLabelText('店に届く名前'), { target: { value:'店の品' } })
  fireEvent.click(screen.getByRole('button', { name:'保存する' }))
  await waitFor(() => expect(calls.create).toHaveBeenCalledWith(expect.objectContaining({ type, name:'本部のひな形', definition:expect.objectContaining({ settings:expect.objectContaining({ name:'店の品' }) }) })))
  expect(await screen.findByRole('button', { name:'店を選ぶ' })).toBeTruthy()
})
it('予約を使わない店は予約メニューの配布先で選べない', async () => {
  calls.accounts.mockResolvedValue([{ id:'a', name:'本店' }, { id:'ec', name:'EC店', style:'ec' }])
  calls.create.mockImplementation(async input => ({ data:{ template:{ id:'t',template_type:'booking_menu',revision:1,name:input.name },definition:input.definition } }))
  render(<CatalogConsole type="booking_menu" />)
  fireEvent.click(await screen.findByRole('button',{name:'ひな形を作る'}))
  fireEvent.change(screen.getByLabelText('統括での名前'),{target:{value:'統括'}})
  fireEvent.change(screen.getByLabelText('店に届く名前'),{target:{value:'予約'}})
  fireEvent.click(screen.getByRole('button',{name:'保存する'}))
  await waitFor(() => expect(calls.picker).toHaveBeenCalledWith(expect.objectContaining({ disabledIds:['ec'], allowed:expect.arrayContaining([expect.objectContaining({ id:'ec',name:'EC店（予約を使っていません）' })]) })))
})
