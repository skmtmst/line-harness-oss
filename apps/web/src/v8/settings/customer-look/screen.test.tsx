// @vitest-environment happy-dom
import type {ComponentProps} from 'react'
import {afterEach,expect,test,vi} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {ApiError} from '@/lib/api'
import {DEFAULT_CUSTOMER_LOOK} from '@line-crm/shared'
const mock=vi.hoisted(()=>({role:'owner',get:vi.fn(),save:vi.fn()}))
vi.mock('@/lib/api',async original=>({...await original<typeof import('@/lib/api')>(),api:{accountSettings:{getCustomerLook:mock.get,saveCustomerLook:mock.save}}}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'a',selectedAccount:{name:'店A'}})}))
vi.mock('@/lib/staff-role',()=>({useStaffRole:()=>mock.role,canManageRole:(role:string)=>['owner','admin'].includes(role)}))
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{},useHideSettingsNav:()=>{}}))
vi.mock('@/components/layout/settings-inner-nav',()=>({default:()=>null}))
vi.mock('@/components/templates/settings-page',()=>({SettingsPage:({children,preview,saveActions,saveStatus}:Pick<ComponentProps<typeof import('@/components/templates/settings-page').SettingsPage>, 'children'|'preview'|'saveActions'|'saveStatus'>)=><div>{children}{preview}{saveStatus}{saveActions}</div>}))
vi.mock('@/components/shared/customer-look-preview',()=>({default:({look}:{look:typeof DEFAULT_CUSTOMER_LOOK})=><p>見本：{look.preset}</p>}))
vi.mock('@/components/shared/toast',()=>({notifyToast:()=>{}}))
vi.mock('@/lib/use-unsaved-guard',()=>({useUnsavedGuard:()=>({guarded:(fn:()=>void)=>fn(),disarm:()=>{},leaveTarget:null})}))
vi.mock('@/lib/unsaved-leave-dialog',()=>({UnsavedLeaveDialog:()=>null}))
import CustomerLookScreen from './screen'
afterEach(()=>{cleanup();vi.clearAllMocks();mock.role='owner'})
test('REQ-F01 競合時は入力を残し、最新の版を読んでから保存する',async()=>{
 mock.get.mockResolvedValue({success:true,data:{look:DEFAULT_CUSTOMER_LOOK,version:3}});render(<CustomerLookScreen/>);await screen.findByRole('radio',{name:/モダン/});
 fireEvent.click(screen.getByRole('radio',{name:/モダン/}));expect(screen.getByText('見本：modern')).toBeTruthy();expect(mock.save).not.toHaveBeenCalled();
 mock.save.mockRejectedValue(new ApiError(409,'他の人が変更しました'));fireEvent.click(screen.getByRole('button',{name:'保存する'}));await screen.findByRole('alert');expect(screen.getByText('見本：modern')).toBeTruthy();
 expect((screen.getByRole('button',{name:'保存する'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByRole('button',{name:'保存する'}).getAttribute('aria-description')).toBe('最新のデザインを読み直してから保存してください');
 mock.get.mockResolvedValue({success:true,data:{look:DEFAULT_CUSTOMER_LOOK,version:4}});fireEvent.click(screen.getByRole('button',{name:'最新を読み直す'}));await vi.waitFor(()=>expect(mock.get).toHaveBeenCalledTimes(2));expect(screen.getByText('見本：modern')).toBeTruthy();
 mock.save.mockResolvedValue({success:true,data:{look:{...DEFAULT_CUSTOMER_LOOK,preset:'modern'},version:5}});await vi.waitFor(()=>expect((screen.getByRole('button',{name:'保存する'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'保存する'}));await vi.waitFor(()=>expect(mock.save).toHaveBeenCalledTimes(2));expect(mock.save).toHaveBeenLastCalledWith('a',expect.objectContaining({preset:'modern'}),4);
})
test('閲覧だけなら変更と保存を出さない',async()=>{mock.role='viewer';mock.get.mockResolvedValue({success:true,data:{look:DEFAULT_CUSTOMER_LOOK,version:3}});render(<CustomerLookScreen/>);await screen.findByText('見本：line');expect(screen.queryByRole('radio')).toBeNull();expect(screen.queryByRole('button',{name:'保存する'})).toBeNull()})

test('未変更では帯を出さず、変更後は保存できる', async () => {
 mock.get.mockResolvedValue({success:true,data:{look:DEFAULT_CUSTOMER_LOOK,version:3}})
 render(<CustomerLookScreen/>); await screen.findByRole('radio',{name:/モダン/})
 for (const name of ['キャンセル','保存する']) expect(screen.queryByRole('button',{name})).toBeNull()
 fireEvent.click(screen.getByRole('radio',{name:/モダン/}))
 const save = screen.getByRole('button',{name:'保存する'}) as HTMLButtonElement
 expect(save.disabled).toBe(false); expect(save.hasAttribute('aria-description')).toBe(false)
})

test('型の下からカスタムへ進み、色と書体を変えて保存できる',async()=>{
 mock.get.mockResolvedValue({success:true,data:{look:DEFAULT_CUSTOMER_LOOK,version:3}})
 mock.save.mockResolvedValue({success:true,data:{look:{...DEFAULT_CUSTOMER_LOOK,preset:'custom',headingFont:'mincho'},version:4}})
 render(<CustomerLookScreen/>);await screen.findByRole('radio',{name:/モダン/})
 const summary=screen.getByText('カスタムの色と書体').closest('summary')!
 expect(summary.parentElement?.hasAttribute('open')).toBe(false)
 expect(summary.textContent).toContain('主の色・背景の色・見出しの書体')
 fireEvent.click(screen.getByRole('radio',{name:/カスタム/}))
 expect(screen.getByText('カスタムの色と書体').closest('details')?.hasAttribute('open')).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'見出しの書体'}))
 fireEvent.click(screen.getByRole('option',{name:'明朝'}).querySelector('button')!)
 await vi.waitFor(()=>expect(screen.getByRole('button',{name:'見出しの書体'}).textContent).toContain('明朝'))
 fireEvent.click(screen.getByRole('button',{name:'保存する'}))
 await vi.waitFor(()=>expect(mock.save).toHaveBeenCalledWith('a',expect.objectContaining({preset:'custom',headingFont:'mincho'}),3))
})
