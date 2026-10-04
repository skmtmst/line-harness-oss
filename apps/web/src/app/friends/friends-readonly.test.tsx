// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
const access = vi.hoisted(() => ({ role: 'staff', friendEdit: false, chatEdit: false }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => access.role, canManageRole: (role: string) => ['owner', 'admin'].includes(role) }))
vi.mock('@/lib/staff-capability', () => ({ canEditFeature: (key: string) => key === '/friends' ? access.friendEdit : access.chatEdit }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import { FriendsListHeadV8 } from './friends-nav-v8'
it('閲覧のみには理由を出し、取り込みを押せないようにする。編集権限のある担当者には閲覧のみと表示しない', () => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(<FriendsListHeadV8 />))
    expect(host.textContent).toContain('閲覧のみの権限です')
    const importer = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('友だちを取り込む'))!
    expect(importer.disabled).toBe(true)
    expect(importer.title).toContain('権限')
    access.chatEdit = true
    act(() => root.render(<FriendsListHeadV8 />))
    expect(host.textContent).not.toContain('閲覧のみの権限です')
  } finally {
    act(() => root.unmount()); host.remove(); access.chatEdit = false
  }
})
