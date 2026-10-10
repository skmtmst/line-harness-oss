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
vi.mock('@/components/layout/settings-nav-v8',()=>({SettingsNavV8:()=>null}))
vi.mock('@/components/templates/settings-page',()=>({SettingsPage:({children,preview,saveActions,saveStatus}:Pick<ComponentProps<typeof import('@/components/templates/settings-page').SettingsPage>, 'children'|'preview'|'saveActions'|'saveStatus'>)=><div>{children}{preview}{saveStatus}{saveActions}</div>}))
vi.mock('@/components/shared/customer-look-preview',()=>({default:({look}:{look:typeof DEFAULT_CUSTOMER_LOOK})=><p>見本：{look.preset}</p>}))
vi.mock('@/components/shared/toast',()=>({notifyToast:()=>{}}))
vi.mock('@/lib/use-unsaved-guard',()=>({useUnsavedGuard:()=>({guarded:(fn:()=>void)=>fn(),disarm:()=>{},leaveTarget:null})}))
vi.mock('@/lib/unsaved-leave-dialog',()=>({UnsavedLeaveDialog:()=>null}))
import CustomerLookScreen from './screen'
afterEach(()=>{cleanup();vi.clearAllMocks();mock.role='owner'})
test('見本は保存しない。失敗時は入力を残し同じ版で再試行する',async()=>{
 mock.get.mockResolvedValue({success:true,data:{look:DEFAULT_CUSTOMER_LOOK,version:3}});render(<CustomerLookScreen/>);await screen.findByRole('radio',{name:/モダン/});
 fireEvent.click(screen.getByRole('radio',{name:/モダン/}));expect(screen.getByText('見本：modern')).toBeTruthy();expect(mock.save).not.toHaveBeenCalled();
 mock.save.mockRejectedValue(new ApiError(409,'他の人が変更しました'));fireEvent.click(screen.getByRole('button',{name:'保存する'}));await screen.findByRole('alert');expect(screen.getByText('見本：modern')).toBeTruthy();
 mock.save.mockResolvedValue({success:true,data:{look:{...DEFAULT_CUSTOMER_LOOK,preset:'modern'},version:4}});fireEvent.click(screen.getByRole('button',{name:'保存する'}));await vi.waitFor(()=>expect(mock.save).toHaveBeenCalledTimes(2));expect(mock.save).toHaveBeenLastCalledWith('a',expect.objectContaining({preset:'modern'}),3);
})
test('閲覧だけなら変更と保存を出さない',async()=>{mock.role='viewer';mock.get.mockResolvedValue({success:true,data:{look:DEFAULT_CUSTOMER_LOOK,version:3}});render(<CustomerLookScreen/>);await screen.findByText('見本：line');expect(screen.queryByRole('radio')).toBeNull();expect(screen.queryByRole('button',{name:'保存する'})).toBeNull()})
