// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({push(){},replace(){}}), usePathname: () => '/hq/templates/starter-sets', useSearchParams: () => new URLSearchParams() }))
vi.mock('next/link', () => ({ default: ({children,href}: {children:React.ReactNode;href:string}) => <a href={href}>{children}</a> }))
vi.mock('@/components/shell/page-chrome', () => ({usePageTitle(){}, usePageCrumbs(){}}))
vi.mock('@/contexts/account-context', () => ({useAccount:()=>({accounts:[]})}))
vi.mock('@/lib/staff-role', () => ({useStaffRole:()=> 'owner',canManageRole:()=>true}))
vi.mock('@/lib/api/helpers/styles', () => ({hqStyleApi:{listStarterSets:net.list,templateSamples:async()=>({success:true,data:{items:[]}})}}))
import Page from './starter-sets'
beforeEach(()=>net.list.mockResolvedValue({success:true,data:[]}))
afterEach(cleanup)
it.each([{sets:[]},{sets:[{style:'restaurant',autoInsert:true,accountCount:2,version:1,definition:{items:[]}}]}])('空のセットで自動挿入ONを示さず、未登録の見出しを出す', async ({sets:data})=>{
 net.list.mockResolvedValue({success:true,data})
 render(<Page/>)
 await screen.findByRole('heading',{name:'飲食店の初期セット（中身は未登録）'})
 expect(screen.getByText('自動で入れる中身はまだありません')).toBeTruthy()
 expect(screen.queryByRole('switch',{name:'新しいアカウントで自動で入れる'})).toBeNull()
 expect(screen.queryByText('自動で入れる')).toBeNull()
})
it('中身があれば保存された挿入設定を表示する', async()=>{
 net.list.mockResolvedValue({success:true,data:[{style:'restaurant',autoInsert:true,accountCount:2,version:1,definition:{items:[{kind:'template',name:'歓迎',id:'a'}]}}]})
 render(<Page/>)
 await waitFor(()=>expect(screen.getByRole('switch',{name:'新しいアカウントで自動で入れる'}).getAttribute('aria-checked')).toBe('true'))
 expect(screen.queryByText('自動で入れる中身はまだありません')).toBeNull()
})
