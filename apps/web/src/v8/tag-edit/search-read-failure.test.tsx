// @vitest-environment happy-dom
import React from 'react'
import {afterEach,it,expect,vi} from 'vitest'
import {render,screen,cleanup,fireEvent} from '@testing-library/react'
const f=vi.hoisted(()=>({list:vi.fn()}))
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()}),useSearchParams:()=>new URLSearchParams('id=s')}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'a',selectedAccount:{name:'人工店'}})}))
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:()=>{},usePageCrumbs:()=>{}}))
vi.mock('@/lib/staff-role',()=>({useStaffRole:()=> 'owner',canManageRole:()=>true}))
vi.mock('@/lib/api',async original=>{
 const actual=await original<typeof import('@/lib/api')>()
 const list=async()=>({success:true,data:[]})
 return {...actual,api:{...actual.api,savedSearches:{...actual.api.savedSearches,list:f.list,detail:async()=>({success:true,data:{id:'s',name:'人工検索',conditions:{all:[],any:[]},revision:1,isShared:false,match:{total:0,byChannel:{line:0,mail:0},calculatedAt:'',error:null}}})},tags:{list},supportMarks:{list},scenarios:{list},friendFields:{list},forms:{list},operators:{list}}}
})
import SearchEdit from './search-edit'
afterEach(cleanup)
it('保存済み検索一覧success:falseを重複名なしと見なさず読み直しへ',async()=>{
 f.list.mockResolvedValue({success:false,error:'fixture failure',items:[],summary:{total:0}})
 render(<SearchEdit/>)
 expect(await screen.findByText(/読み込めませんでした/)).toBeTruthy()
 expect(screen.queryByDisplayValue('人工検索')).toBeNull()
 expect(screen.queryByText(/いま0 件/)).toBeNull()
 f.list.mockResolvedValue({success:true,items:[],summary:{total:24}})
 fireEvent.click(screen.getByRole('button',{name:/もう一度/}))
 expect(await screen.findByDisplayValue('人工検索')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'共有の説明'}))
 expect(screen.getByText(/いま24 件/)).toBeTruthy()
})
