// @vitest-environment happy-dom
import React from 'react'
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const fixture=vi.hoisted(()=>({snapshot:vi.fn(),loginMembers:vi.fn(),linkMembershipLogin:vi.fn(),updateMembership:vi.fn(),gate:vi.fn(),cancel:vi.fn()}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'account-1',accounts:[]})}))
vi.mock('@/lib/restaurant-test-api',()=>({restaurantTestApi:fixture}))
vi.mock('@/components/step-up-prompt',()=>({useStepUpGate:()=>({gate:fixture.gate,cancel:fixture.cancel,prompt:null}),isStepUpRequired:(e:any)=>e.code==='STEP_UP_REQUIRED'}))
import OrganizationV8 from './organization'
const member={id:'member',organization_id:'org',store_id:'store',staff_name:'試験担当',email:null,role:'staff',status:'active',staff_id:'login',loginName:'試験ログイン',loginRole:'staff',loginPolicyVersion:3,loginAccountScope:'accounts',line_uid:null,google_email:null}
const data={organization:{id:'org',name:'試験組織'},stores:[{id:'store',name:'試験店',code:'S',status:'active',line_account_id:'account-1'}],memberships:[member],tables:[],menuItems:[],reservations:[],inventory:[],approvals:[],connectors:[],reviews:[],posts:[],lineFlows:[]}
beforeEach(()=>{fixture.snapshot.mockResolvedValue({data});fixture.loginMembers.mockResolvedValue({data:[{id:'login',name:'試験ログイン'},{id:'next',name:'別のログイン'}]});fixture.updateMembership.mockResolvedValue({success:true});fixture.linkMembershipLogin.mockResolvedValue({success:true})})
afterEach(()=>{cleanup();vi.resetAllMocks()})
it('実際のログイン役割と版を表示し、既存メンバーとの連携を保存する',async()=>{
 render(<OrganizationV8 />)
 const row=(await screen.findByText('試験担当')).closest('tr')!
 expect(row.textContent).toContain('試験ログイン・スタッフ');expect(row.textContent).toContain('版 3')
 fireEvent.click(await screen.findByRole('button',{name:'試験担当のログインメンバー'}))
 fireEvent.click(within(await screen.findByRole('option',{name:'別のログイン'})).getByRole('button'))
 await waitFor(()=>expect(screen.getByRole('button',{name:'試験担当のログインメンバー'}).textContent).toContain('別のログイン'))
 fireEvent.click(screen.getByRole('button',{name:'ログインと連携'}))
 await waitFor(()=>expect(fixture.linkMembershipLogin).toHaveBeenCalledWith('account-1','member','next'))
})
it('連携メンバーの停止は版を送り、本人確認が必要なら確認後に再送する',async()=>{
 fixture.updateMembership.mockRejectedValueOnce({code:'STEP_UP_REQUIRED'}).mockResolvedValueOnce({success:true});fixture.gate.mockResolvedValue('verified-token')
 render(<OrganizationV8 />)
 const row=(await screen.findByText('試験担当')).closest('tr')!
 fireEvent.click(within(row).getByRole('button',{name:'停止'}));fireEvent.click(screen.getByRole('button',{name:'停止する'}))
 await waitFor(()=>expect(fixture.updateMembership).toHaveBeenCalledTimes(2))
 expect(fixture.gate).toHaveBeenCalledWith('staff.permissions.change','店の役割とログイン権限を変更する')
 expect(fixture.updateMembership).toHaveBeenLastCalledWith('account-1','member',expect.objectContaining({status:'suspended',expectedPolicyVersion:3}), 'verified-token')
 expect(fixture.updateMembership.mock.calls[0][2].idempotencyKey).toBe(fixture.updateMembership.mock.calls[1][2].idempotencyKey)
})
it('本人確認を中止した場合は権限変更を再送しない',async()=>{
 fixture.updateMembership.mockRejectedValueOnce({code:'STEP_UP_REQUIRED'});fixture.gate.mockResolvedValue(null)
 render(<OrganizationV8 />);const row=(await screen.findByText('試験担当')).closest('tr')!
 fireEvent.click(within(row).getByRole('button',{name:'停止'}));fireEvent.click(screen.getByRole('button',{name:'停止する'}))
 await screen.findByText('保存できませんでした。')
 expect(fixture.updateMembership).toHaveBeenCalledTimes(1)
})
