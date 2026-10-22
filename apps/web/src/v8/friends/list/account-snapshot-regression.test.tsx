// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFriendsListSnapshot, writeFriendsListSnapshot } from './list-state'
const fx=vi.hoisted(()=>({ account:'A', urlFilters: false }))
vi.mock('next/navigation',()=>({ useRouter:()=>({ push:vi.fn(),replace:vi.fn() }),useSearchParams:()=>new URLSearchParams(fx.urlFilters ? window.location.search : ''),usePathname:()=>'/friends' }))
vi.mock('next/link',()=>({ default:({ children }: { children: React.ReactNode })=><span>{children}</span> }))
vi.mock('@/contexts/account-context',()=>({ useAccount:()=>({ selectedAccountId:fx.account,loading:false }) }))
vi.mock('@/components/shell/page-chrome',()=>({ usePageTitle:vi.fn() }))
vi.mock('@/lib/staff-role',()=>({ useStaffRole:()=> 'owner',canManageRole:()=>true }))
vi.mock('@/lib/use-feature-visibility',()=>({ useFeatureVisibility:()=>({ enabled:()=>false }) }))
vi.mock('@/lib/operators-cache',()=>({ loadOperators:async()=>[] }))
vi.mock('@/lib/api',async original=>{ const actual=await original<typeof import('@/lib/api')>();return { ...actual,api:{ ...actual.api,friends:{ list:async()=>({ success:true,data:{ items:[],total:0 } }) },friendStats:{ get:async()=>({ success:false }) },tags:{ list:async()=>({ success:true,data:[] }) },scenarios:{ list:async()=>({ success:true,data:[] }) } } } })
import List from './list'
import { flushListUrlState } from '@/components/shared/list-url-state'
beforeEach(() => { fx.urlFilters = false; flushListUrlState(); window.history.replaceState(null, '', '/friends') })
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

it('空の一覧の条件解除はURL由来の点数・宛先・保存した検索も外す', async () => {
  fx.urlFilters = true
  window.history.replaceState(null, '', '/friends?tag=tag-a&q=検索&responseFilter=unhandled&operatorId=staff&scenarioId=scenario&attentionOnly=1&scoreMin=10&scoreMax=20&scoredOnly=1&audienceId=audience&savedSearch=saved')
  fx.account = 'A'
  const view = render(<List />)
  const clear = await screen.findByRole('button', { name: '条件を外す' })
  fireEvent.click(clear)
  flushListUrlState()
  view.rerender(<List />)
  await waitFor(() => expect(screen.getByText('まだ友だちがいません')).toBeTruthy())
  const params = new URLSearchParams(window.location.search)
  for (const key of ['q', 'tag', 'advanced', 'responseFilter', 'operatorId', 'scenarioId', 'attentionOnly', 'scoreMin', 'scoreMax', 'scoredOnly', 'audienceId', 'savedSearch']) expect(params.has(key), key).toBe(false)
})
