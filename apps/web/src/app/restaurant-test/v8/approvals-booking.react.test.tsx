// @vitest-environment happy-dom
import React from 'react'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const fixture=vi.hoisted(()=>({snapshot:vi.fn(),decideApproval:vi.fn()}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'a',accounts:[]})}))
vi.mock('@/lib/staff-role',()=>({useStaffRole:()=> 'admin',canManageRole:()=>true}))
vi.mock('@/lib/restaurant-test-api',()=>({restaurantTestApi:fixture}))
import ApprovalsV8 from './approvals'
const data={organization:{id:'o',name:'試験'},stores:[{id:'s',name:'試験店',code:'S',status:'active'}],memberships:[],tables:[],menuItems:[],reservations:[],inventory:[],approvals:[{id:'r',store_id:'s',kind:'menu_change',status:'pending',title:'価格変更',payload_json:'{"before":"8000円","after":"9000円"}',created_at:'2099-01-01T00:00:00Z'}],connectors:[],reviews:[],posts:[],lineFlows:[]}
beforeEach(()=>fixture.snapshot.mockResolvedValue({data}))
afterEach(()=>{cleanup();vi.resetAllMocks()})
it('承認時に基準価格が変わって反映できなければ、再申請の理由を表示する',async()=>{
 fixture.decideApproval.mockResolvedValue({data:{id:'r',status:'approved',menuChangeStatus:'failed',failureReason:'メニューが変更または削除されています。再申請してください'}})
 render(<ApprovalsV8 />)
 fireEvent.click(await screen.findByRole('button',{name:'承認する'}))
 await screen.findByText('メニューが変更または削除されています。再申請してください')
 expect(screen.queryByText('承認しました。外部公開は行っていません。')).toBeNull()
 await waitFor(()=>expect(fixture.snapshot.mock.calls.length).toBeGreaterThan(1))
})
it('開始待ちの価格は承認を成功として表示する',async()=>{
 fixture.decideApproval.mockResolvedValue({data:{id:'r',status:'approved',menuChangeStatus:'approved',failureReason:null}})
 render(<ApprovalsV8 />);fireEvent.click(await screen.findByRole('button',{name:'承認する'}))
 await screen.findByText('承認しました。外部公開は行っていません。')
})
