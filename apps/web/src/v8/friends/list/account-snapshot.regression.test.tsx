// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { readFriendsListSnapshot, writeFriendsListSnapshot } from './list-state'
const fx=vi.hoisted(()=>({ account:'A' }))
vi.mock('next/navigation',()=>({ useRouter:()=>({ push:vi.fn(),replace:vi.fn() }),useSearchParams:()=>new URLSearchParams(),usePathname:()=>'/friends' }))
vi.mock('next/link',()=>({ default:({ children }: { children: React.ReactNode })=><span>{children}</span> }))
vi.mock('@/contexts/account-context',()=>({ useAccount:()=>({ selectedAccountId:fx.account,loading:false }) }))
vi.mock('@/components/shell/page-chrome',()=>({ usePageTitle:vi.fn() }))
vi.mock('@/lib/staff-role',()=>({ useStaffRole:()=> 'owner',canManageRole:()=>true }))
vi.mock('@/lib/use-feature-visibility',()=>({ useFeatureVisibility:()=>({ enabled:()=>false }) }))
vi.mock('@/lib/operators-cache',()=>({ loadOperators:async()=>[] }))
vi.mock('@/lib/api',async original=>{ const actual=await original<typeof import('@/lib/api')>();return { ...actual,api:{ ...actual.api,friends:{ list:async()=>({ success:true,data:{ items:[],total:0 } }) },friendStats:{ get:async()=>({ success:false }) },tags:{ list:async()=>({ success:true,data:[] }) },scenarios:{ list:async()=>({ success:true,data:[] }) } } } })
import List from './list'
afterEach(()=>{ cleanup();window.sessionStorage.clear() })
const snapshot=(name:string)=>({ searchInput:name,searchSubmitted:name,selectedTagId:'',responseFilter:'all' as const,operatorId:'',scenarioId:'',attentionOnly:false,sortMode:'recent' as const,page:1,pageSize:20,advanced:null })
it('A→B→Aの各条件を復元前に上書きしない（WEB184）',async()=>{
  fx.account='A';writeFriendsListSnapshot('A',snapshot('Aの検索'));writeFriendsListSnapshot('B',snapshot('Bの検索'))
  const view=render(<List />);await screen.findByDisplayValue('Aの検索')
  fx.account='B';view.rerender(<List />);await screen.findByDisplayValue('Bの検索')
  expect(readFriendsListSnapshot('B')?.searchSubmitted).toBe('Bの検索')
  fx.account='A';view.rerender(<List />);await screen.findByDisplayValue('Aの検索')
  expect(readFriendsListSnapshot('A')?.searchSubmitted).toBe('Aの検索')
})
it('控えがないアカウントには前の条件を引き継がない（WEB184）',async()=>{
  fx.account='A';writeFriendsListSnapshot('A',snapshot('Aの検索'))
  const view=render(<List />);await screen.findByDisplayValue('Aの検索')
  fx.account='C';view.rerender(<List />)
  await waitFor(()=>expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(''))
})
