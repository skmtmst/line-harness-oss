// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ query: 'id=synthetic-rule&step=response', getDraft: vi.fn(), validateDraft: vi.fn(), list: vi.fn(), saveDraft: vi.fn(), testDraft: vi.fn(), accounts: [{id:'synthetic-account'}] }))
vi.mock('next/navigation', () => ({useRouter: () => ({replace: (url: string) => {net.query = url.split('?')[1]}, push: vi.fn()}), useSearchParams: () => new URLSearchParams(net.query)}))
vi.mock('@/contexts/account-context', () => ({useAccount: () => ({selectedAccountId: 'synthetic-account', accounts: net.accounts})}))
vi.mock('@/components/shell/page-chrome', () => ({usePageTitle: () => {}}))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({enabled: () => false, status: 'ready'}) }))
vi.mock('@/lib/staff-role', () => ({useStaffRole: () => 'owner', canManageRole: () => true}))
vi.mock('@/components/auto-replies/inline-action-list', () => ({default: () => null, useActionOptions: () => ({tags:[],fields:[],marks:[],scenarios:[],vars:[]})}))
vi.mock('@/components/shared/select', () => ({ default: ({value,onChange,options,...props}: {value: string; onChange: (value: string) => void; options: Array<{value: string; label: string}>; 'aria-label'?: string}) => <select aria-label={props['aria-label']} value={value} onChange={e=>onChange(e.target.value)}>{options.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}</select> }))
vi.mock('@/lib/api', async importOriginal => {const actual = await importOriginal<typeof import('@/lib/api')>(); return {...actual,api:{autoReplies:{getDraft:net.getDraft,get:async()=>({success:true,data:{isActive:true}}),list:net.list,conflicts:async()=>({success:true,data:{conflicts:[]}}),validateDraft:net.validateDraft,saveDraft:net.saveDraft,testDraft:net.testDraft},templates:{list:async()=>({success:true,data:[]})},folders:{list:async()=>({success:true,data:[]})},friends:{list:async()=>({success:true,data:{items:[{id:'synthetic-friend',displayName:'試験の友だち'}],total:1}})}}}})
import Page from './wizard-v8'
const DRAFT = {
  autoReplyId: 'synthetic-rule',
  versionId: 'synthetic-version',
  versionNumber: 1,
  status: 'draft',
  settings: {
    keyword: 'test',
    matchType: 'exact',
    responseType: 'text',
    responseContent: 'test',
    templateId: null,
    lineAccountId: 'synthetic-account',
    activeFrom: null,
    activeUntil: null,
    cooldownMinutes: null,
    skipWhenOperatorActive: false,
    priority: 0,
    messageKinds: null,
    receiveSources: ['line'],
    friendConditions: null,
    actions: null,
    responseWeekdays: null,
    responseHolidayRule: null,
    oncePerFriend: false,
    keywords: null,
    respondToAll: false,
    name: 'J7 synthetic reply',
    keywordMatchMode: 'any',
    folderId: null,
    internalMemo: null,
    replyDelaySeconds: null,
    unmatchedAction: null,
  },
  lastTestStatus: null,
  lastTestedAt: null,
  publishedAt: null,
}

beforeEach(()=> {
 net.query='id=synthetic-rule&step=response';net.accounts=[{id:'synthetic-account'}];vi.clearAllMocks()
 net.getDraft.mockResolvedValue({success:true,data:DRAFT});net.validateDraft.mockResolvedValue({success:true,data:{errors:[],warnings:[],conflicts:[]}})
 net.list.mockResolvedValue({success:true,data:[]});net.saveDraft.mockResolvedValue({success:true,data:{...DRAFT,versionNumber:2}})
})
afterEach(cleanup)
it('WEB293: 次へから優先順位へ入る取得を一度だけ行う',async()=>{
 const view=render(<Page/>);await act(async()=>{})
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:/次へ/})))
 view.rerender(<Page/>);await act(async()=>{})
 expect(net.list).toHaveBeenCalledTimes(1)
})
it('WEB292: 編集後に履歴で確認へ戻っても古い確認を使わず保存し直す',async()=>{
 net.query='id=synthetic-rule&step=confirm';const view=render(<Page/>);await act(async()=>{})
 expect(net.validateDraft).toHaveBeenCalledTimes(1)
 net.query='id=synthetic-rule&step=basic';view.rerender(<Page/>);await act(async()=>{})
 fireEvent.change(screen.getByLabelText(/ルール名/),{target:{value:'変更した名前'}})
 net.query='id=synthetic-rule&step=confirm';view.rerender(<Page/>);await act(async()=>{})
 expect(net.saveDraft).toHaveBeenCalledTimes(1)
 expect(net.validateDraft).toHaveBeenCalledTimes(2)
})
it('WEB294: アカウント配列の再取得だけで入力を取り直さない',async()=>{
 net.query='id=synthetic-rule&step=basic';const view=render(<Page/>);await act(async()=>{})
 const input=screen.getByLabelText<HTMLInputElement>(/ルール名/)
 fireEvent.change(input,{target:{value:'編集中'}})
 net.accounts=[{id:'synthetic-account'}];view.rerender(<Page/>);await act(async()=>{})
 expect(net.getDraft).toHaveBeenCalledTimes(1)
 expect(input.value).toBe('編集中')
})

it('WEB292: 入力変更後に遅れて届いた前の版の試験結果を使わない',async()=>{
 net.query='id=synthetic-rule&step=priority'
 let finish!: (value: unknown) => void
 net.testDraft.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 const view=render(<Page/>);await act(async()=>{})
 fireEvent.change(document.querySelector('#wiz-test-message') as HTMLInputElement,{target:{value:'test'}})
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'試す',exact:true})))
 expect(net.testDraft).toHaveBeenCalledTimes(1)
 net.query='id=synthetic-rule&step=basic';view.rerender(<Page/>);await act(async()=>{})
 fireEvent.change(screen.getByLabelText(/ルール名/),{target:{value:'変更した名前'}})
 net.query='id=synthetic-rule&step=priority';view.rerender(<Page/>);await act(async()=>{})
 await act(async()=>finish({success:true,data:{draftWon:true,winner:null,candidates:[],staleTest:false}}))
 expect(screen.queryByText('このルールが返します。')).toBeNull()
})
