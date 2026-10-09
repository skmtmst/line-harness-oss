// @vitest-environment happy-dom
import React from 'react'
import {act,cleanup,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const net=vi.hoisted(()=>({account:'a',query:'id=r&done=1',test:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({replace:vi.fn(),push:vi.fn()}),useSearchParams:()=>new URLSearchParams(net.query)}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:net.account,accounts:[]})}))
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{}}))
vi.mock('@/lib/staff-role',()=>({useStaffRole:()=> 'owner',canManageRole:()=>true}))
vi.mock('@/lib/api',async importOriginal=> {const actual=await importOriginal<typeof import('@/lib/api')>();return {...actual,api:{staff:{me:async()=>({success:true,data:{name:'担当'}})},friendAddRules:{get:async()=>({success:true,data:{rule:{id:'r',name:'案内',status:'stopped',friendKind:'first_time',priority:1,routeNames:[],definition:{routeIds:[],actions:[],messageType:'text',messageText:'案内'}},options:{routes:[],scenarios:[],tags:[]}}}),validate:async()=>({success:true,data:{canPublish:true,checks:[],estimatedAudienceCount:1}}),conflicts:async()=>({success:true,data:{rules:[],conflicts:[]}}),test:net.test}}}})
import Page from './publish'
beforeEach(()=>{net.account='a';net.query='id=r&done=1';net.test.mockReset()})
afterEach(cleanup)
it('WEB154: doneのURLでも停止中を有効化完了と表示しない',async()=>{
 const view=render(<Page/>);await act(async()=>{})
 expect(view.container.querySelector('[data-design-node="e0FD1J"]')).toBeNull()
 expect(view.container.textContent).toContain('停止中')
})
it('WEB156: テスト待ちで切り替えても新しいアカウントを処理中にしない',async()=>{
 net.query='id=r';let resolve!: (value:unknown)=>void
 net.test.mockImplementation(()=>new Promise(done=>{resolve=done}))
 const view=render(<Page/>);await act(async()=>{})
 await act(async()=>screen.getByRole('button',{name:'テストする（送らずに判定）'}).click())
 net.account='b';view.rerender(<Page/>);await act(async()=>{})
 expect(screen.getByRole<HTMLButtonElement>('button',{name:'テストする（送らずに判定）'}).disabled).toBe(false)
 await act(async()=>resolve({success:true,data:{matched:true}}))
 expect(view.container.textContent).not.toContain('テストが完了')
})
