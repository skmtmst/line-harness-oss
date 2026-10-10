// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams(),usePathname:()=>'/friends'}))
vi.mock('next/link',()=>({default:({children}:{children:React.ReactNode})=><span>{children}</span>}))
vi.mock('@/contexts/account-context',()=>({useAccount:()=>({selectedAccountId:'A',loading:false})}))
vi.mock('@/components/shell/page-chrome',()=>({usePageTitle:vi.fn()}))
vi.mock('@/lib/staff-role',()=>({useStaffRole:()=> 'owner',canManageRole:()=>true}))
vi.mock('@/lib/use-feature-visibility',()=>({useFeatureVisibility:()=>({enabled:(key:string)=>key==='friend_fields'})}))
vi.mock('@/lib/operators-cache',()=>({loadOperators:async()=>({success:true,data:[]})}))
vi.mock('@/components/friends/advanced-search-dialog',()=>({default:({open,fieldNames}:{open:boolean,fieldNames:string[]})=>open?<output aria-label="友だち情報の候補">{fieldNames.join(',')}</output>:null}))
const listFields=vi.hoisted(()=>vi.fn(async()=>({success:true,data:[{id:'field-a',name:'プラン'}]})))
vi.mock('@/lib/api',async original=>{const actual=await original<typeof import('@/lib/api')>();return {...actual,api:{...actual.api,folders:{...actual.api.folders,list:async()=>({success:true,data:[]})},friends:{list:async()=>({success:true,data:{items:[],total:0}})},friendFields:{...actual.api.friendFields,list:listFields},friendStats:{get:async()=>({success:false})},tags:{list:async()=>({success:true,data:[]})},scenarios:{list:async()=>({success:true,data:[]})}}}})
import List from './list'
afterEach(()=>{cleanup();sessionStorage.clear()})
test('友だち一覧の詳細条件には選んだ店の情報欄の候補を渡す', async()=>{
  render(<List />)
  fireEvent.click(screen.getByRole('button',{name:'詳細条件'}))
  expect(await screen.findByText('プラン')).toBeTruthy()
  expect(listFields).toHaveBeenCalledWith('A')
})

test('表示項目を開くたびに最新の店の欄を読み直す',async()=>{
 listFields.mockClear();render(<List/>);await waitFor(()=>expect(listFields).toHaveBeenCalledTimes(1));
 listFields.mockResolvedValueOnce({success:true,data:[{id:'new-field',name:'新しい項目'}]});
 fireEvent.click(screen.getByRole('button',{name:'表示項目を編集'}));
 expect(await screen.findByRole('checkbox',{name:'新しい項目'})).toBeTruthy();expect(listFields).toHaveBeenCalledTimes(2);
})
