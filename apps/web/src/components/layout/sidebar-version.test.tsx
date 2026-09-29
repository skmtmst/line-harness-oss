// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAdminVersionCache } from '@/lib/admin-version-cache'
import SidebarVersion from './sidebar-version'

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

  it('版・commit・日時・環境が取れると2行出す', async () => {
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
    expect(host.textContent).toContain('Ver. 2.7.0（a1b2c3d）')
    expect(host.textContent).toContain('9/27 13:05 配備・検証環境')
    expect(host.textContent).not.toContain('版の情報なし')
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
