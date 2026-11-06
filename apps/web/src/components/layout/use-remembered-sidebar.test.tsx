// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { MENU_SECTIONS } from '@/lib/menu'
import { useRememberedSidebar } from './use-remembered-sidebar'
const identity = { id: 'staff-a', tenantId: 'tenant-a', role: 'owner', permissionKeys: [] } as unknown as StaffMember
beforeEach(() => { window.sessionStorage.clear(); rememberStaffIdentity(identity) })
afterEach(() => { cleanup(); forgetStaffIdentity() })
it('読み直し・再マウント中も同じ人と店舗の前回項目を出し、最新の結果で置き換える', () => {
 const previous = MENU_SECTIONS.slice(0, 3), minimal = MENU_SECTIONS.slice(0, 1)
 const hook = renderHook(({current,loading}) => useRememberedSidebar(current, MENU_SECTIONS, 'account-a', loading, !loading), {initialProps:{current:previous,loading:false}})
 hook.rerender({current:minimal,loading:true})
 expect(hook.result.current.map(row=>row.id)).toEqual(previous.map(row=>row.id))
 hook.unmount()
 const again = renderHook(() => useRememberedSidebar(minimal, MENU_SECTIONS, 'account-a', true, false))
 expect(again.result.current.map(row=>row.id)).toEqual(previous.map(row=>row.id))
 again.unmount()
 const fresh = renderHook(() => useRememberedSidebar(minimal, MENU_SECTIONS, 'account-a', false, true))
 expect(fresh.result.current).toEqual(minimal)
})
it('別店舗・別人・権限変更・本人未確認へ前回項目を持ち越さない', () => {
 const previous = MENU_SECTIONS.slice(0, 3), minimal = MENU_SECTIONS.slice(0, 1)
 const hook = renderHook(({account,loading}) => useRememberedSidebar(loading ? minimal : previous, MENU_SECTIONS, account, loading, !loading), {initialProps:{account:'account-a',loading:false}})
 hook.rerender({account:'account-b',loading:true}); expect(hook.result.current).toEqual(minimal)
 for (const staff of [{...identity,id:'staff-b'},{...identity,permissionKeys:['/friends']},null]) {
  act(()=>staff ? rememberStaffIdentity(staff) : forgetStaffIdentity())
  hook.rerender({account:'account-a',loading:true}); expect(hook.result.current).toEqual(minimal)
 }
})
