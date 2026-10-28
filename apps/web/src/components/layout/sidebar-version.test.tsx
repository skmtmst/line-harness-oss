// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAdminVersionCache } from '@/lib/admin-version-cache'
import SidebarVersion from './sidebar-version'

const access = vi.hoisted(() => ({ role: 'owner' as string | null }))
vi.mock('@/lib/staff-role', () => ({ canManageRole: (role: string | null) => role === 'owner' || role === 'admin', useStaffRole: () => access.role }))
vi.mock('@/components/update/use-update-status', () => ({ useUpdateStatus: () => ({ kind: 'none' }) }))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const fetchMock = vi.fn()

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

function json(data: unknown) {
  return { ok: true, json: async () => data } as Response
}

describe('メニューの下の版の表示（m18e・設計E）', () => {
  beforeEach(() => {
    access.role = 'owner'
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    clearAdminVersionCache()
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
    vi.unstubAllGlobals()
    delete process.env.NEXT_PUBLIC_API_URL
    clearAdminVersionCache()
  })

  it('読み込む間も1行ぶんの高さを見えない形で取っておく（動きの点検 11 番）', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    act(() => { root.render(<SidebarVersion />) })
    const reserve = host.querySelector('[data-version-reserve]')
    expect(reserve).not.toBeNull()
    expect(reserve?.getAttribute('aria-hidden')).toBe('true')
    expect(reserve?.className).toContain('invisible')
    expect(reserve?.querySelectorAll('p').length).toBe(1)
  })

  it('版と環境の1行にたたみ、開くと commit・配備の日時が出る', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
    fetchMock.mockResolvedValue(json({
      version: '2.7.0',
      worker_hash: '',
      admin_hash: '',
      liff_hash: '',
      git_commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      deploy_env: 'staging',
      released_at: '2026-09-27T04:05:00Z',
    }))
    act(() => { root.render(<SidebarVersion />) })
    await settle()
    const details = host.querySelector('details')
    expect(details).not.toBeNull()
    expect(details?.open).toBe(false)
    expect(details?.querySelector('summary')?.textContent).toBe('v2.7.0・検証環境')
    expect(details?.querySelector('summary')?.textContent).not.toContain('a1b2c3d')
    act(() => { details?.querySelector('summary')?.click() })
    expect(details?.open).toBe(true)
    expect(host.textContent).toContain('Ver. 2.7.0（a1b2c3d）')
    expect(host.textContent).toContain('9月27日 13:05 配備・検証環境')
    expect(host.textContent).not.toContain('版の情報なし')
    expect(host.querySelector('a[href="/updates"]')?.textContent).toBe('手動で更新')
  })

  it('閲覧のみには更新リンクを出さず、理由を説明する', async () => {
    access.role = 'viewer'
    process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
    fetchMock.mockResolvedValue(json({ version: '2.7.0', git_commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', deploy_env: 'staging', released_at: '2026-09-27T04:05:00Z' }))
    act(() => { root.render(<SidebarVersion />) })
    await settle()
    act(() => { host.querySelector('summary')?.click() })
    expect(host.querySelector('a[href="/updates"]')).toBeNull()
    const reason = host.querySelector<HTMLButtonElement>('button[aria-label="手動で更新"]')
    expect(reason).not.toBeNull()
    act(() => { reason?.click() })
    expect(host.textContent).toContain('更新できるのはオーナーと管理者です。')
  })

  it('取れないときは「版の情報なし」。赤や仮値は出さない', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
    fetchMock.mockRejectedValue(new Error('down'))
    act(() => { root.render(<SidebarVersion />) })
    await settle()
    expect(host.textContent).toContain('版の情報なし')
    expect(host.querySelectorAll('button').length).toBe(0)
  })

  it('仮の版（0.0.0-dev）のときも「版の情報なし」', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
    fetchMock.mockResolvedValue(json({
      version: '0.0.0-dev',
      worker_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      admin_hash: '',
      liff_hash: '',
      git_commit: 'unknown',
      deploy_env: 'staging',
      released_at: '1970-01-01T00:00:00Z',
    }))
    act(() => { root.render(<SidebarVersion />) })
    await settle()
    expect(host.textContent).toContain('版の情報なし')
    expect(host.textContent).not.toContain('0.0.0-dev')
  })
})
