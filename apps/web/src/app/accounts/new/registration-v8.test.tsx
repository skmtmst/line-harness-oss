// @vitest-environment happy-dom
import { afterEach,beforeEach,expect,test,vi } from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import Page from './page'
const calls=vi.hoisted(()=>({list:vi.fn(),tags:vi.fn(),staff:vi.fn(),connectCheck:vi.fn(),connect:vi.fn()}))
vi.mock('@/lib/use-admin-theme',()=>({useAdminTheme:()=> 'v8'}))
vi.mock('@/lib/api',()=>({api:{lineAccounts:{list:calls.list,connectCheck:calls.connectCheck,connect:calls.connect},lineAccountTags:{list:calls.tags},staff:{list:calls.staff}}}))
vi.mock('next/navigation',()=>({usePathname:()=>'/accounts/new',useRouter:()=>({push:vi.fn()})}))
afterEach(() => { cleanup(); window.localStorage?.clear() })
beforeEach(()=>{
 vi.resetAllMocks(); calls.tags.mockResolvedValue({success:true,data:[{id:'tag',name:'本店',color:null}]});calls.list.mockResolvedValue({success:true,data:[{id:'parent',name:'本部',isActive:true}]});calls.staff.mockResolvedValue({success:true,data:[{id:'member',name:'担当者',isActive:true,accountScope:'accounts',inviteStatus:'active'}]});calls.connectCheck.mockResolvedValue({success:true,data:{steps:[],followerImport:{capability:'unknown',phase:'not_started'}}})
})
test('V8 registration forwards tags, parent, staff and chosen LIFF together',async()=>{
 render(<Page/>);
 fireEvent.click(screen.getByRole('button',{name:'次へ'}));
 for(const [id,value] of [['v8-channel-id','123'],['v8-channel-secret','fixture'],['v8-login-channel-id','2007123456'],['v8-login-channel-secret','fixture']])fireEvent.change(document.getElementById(id)!,{target:{value}})
 fireEvent.click(screen.getByRole('button',{name:'次へ'}));
 fireEvent.click(await screen.findByRole('button',{name:'本店'}));fireEvent.click(screen.getByRole('button',{name:'いま決める'}));fireEvent.click(await screen.findByLabelText('担当者'));
 fireEvent.click(screen.getByRole('button',{name:'親アカウント'}));fireEvent.click(screen.getByRole('option',{name:'本部'}).querySelector('button')!);
 fireEvent.change(screen.getByLabelText('既存のLIFF ID（任意）'),{target:{value:'2007123456-existing'}})
 fireEvent.click(screen.getByRole('button',{name:'次へ'}));fireEvent.click(screen.getByRole('button',{name:'接続して設定する'}));
 await waitFor(()=>expect(calls.connectCheck).toHaveBeenCalledWith(expect.objectContaining({tagIds:['tag'],parentLineAccountId:'parent',staffIds:['member'],liffId:'2007123456-existing'})))
})
