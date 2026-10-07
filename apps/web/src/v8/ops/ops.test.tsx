// @vitest-environment happy-dom
/*
 * ★V8 運営コンソール（src/v8/ops）の動きの試験。BEHAVIOR.md の主な動きを守る。
 * V8 のテーマで表示し、閲覧のみの人に押せないボタンを置かないこと・送る前に必ず確かめること・
 * 停止の窓が名前と理由を確かめるまで口を呼ばないことを見る。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/ops/members',
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }))

import OpsShellV8 from './shell'
import OpsMembersV8 from './members'
import OpsTenantsV8 from './tenants'
import OpsAnnouncementsV8 from './announcements'
import OpsTenantDetailV8 from './tenant-detail'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const ME = { id: 'ops-1', name: '検証 太郎', email: null, readOnly: false, totpEnabled: true, lineLinked: false, legacy: false, impersonation: null }
const MEMBERS = [
  { staffId: 'ops-1', name: '検証 太郎', email: 'a@example.com', isActive: true, totpEnabled: true, lineLinked: false, inviteStatus: 'accepted', activationState: 'active', invitedAt: null, approvedBy: null, lastLoginAt: null, createdAt: '2026-09-01T00:00:00Z' },
  { staffId: 'ops-2', name: '見本 次郎', email: 'b@example.com', isActive: true, totpEnabled: true, lineLinked: false, inviteStatus: 'accepted', activationState: 'active', invitedAt: null, approvedBy: null, lastLoginAt: null, createdAt: '2026-09-01T00:00:00Z' },
]
const TENANT = {
  id: 't1', name: '契約先A', status: 'active', featurePacks: [], plan_key: 'standard', plan_status: 'active', trial_ends_at: null,
  current_period_ends_at: null, created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z', account_count: 1, staff_count: 1, last_login_at: null,
}

let readOnly = false
let calls: Array<{ method: string; url: string }> = []
let root: Root
let host: HTMLDivElement

beforeEach(() => {
  readOnly = false
  search = ''
  calls = []
  document.documentElement.dataset.theme = 'v8'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url })
    if (url.endsWith('/api/ops/me')) return json({ success: true, data: { ...ME, readOnly } })
    if (url.endsWith('/api/ops/members')) return json({ success: true, data: MEMBERS, summary: { members: 2, invited: 0, awaitingTotp: 0, totpEnabled: 2, impersonationsThisMonth: 0, writeImpersonationsThisMonth: 0, piiRevealsThisMonth: 0 } })
    if (url.includes('/api/ops/tenants/t1')) return json({ success: true, data: { tenant: TENANT, accounts: [], members: [], audit: [] } })
    if (url.includes('/api/ops/tenants')) return json({ success: true, data: [TENANT], summary: { active: 1, trialing: 0, suspended: 0, pastDue: 0 } })
    if (url.endsWith('/api/ops/announcements/preview')) return json({ success: true, data: { tenants: 1, staff: 1, lineLinked: 0, withEmail: 1 } })
    if (url.endsWith('/api/ops/announcements')) {
      if (method !== 'GET') return json({ success: false, error: 'should not be called' }, 500)
      return json({ success: true, data: [], linked: { linked: 0, total: 1 }, noticeLineConfigured: true })
    }
    return json({ success: false, error: 'unexpected' }, 404)
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete document.documentElement.dataset.theme
  vi.unstubAllGlobals()
})

async function settle(turns = 12) {
  for (let i = 0; i < turns; i += 1) await act(async () => { await Promise.resolve() })
}
const text = () => document.body.textContent ?? ''
const buttons = (label: string) => [...document.body.querySelectorAll('button, a')].filter((el) => el.textContent?.trim() === label)

describe('運営コンソールの V8 外枠', () => {
  it('運営のメニュー・パンくず・注意の帯を出す', async () => {
    await act(async () => {
      root.render(<OpsShellV8 me={ME} meError="" onRetryMe={() => {}} pathname="/ops/members"><p>中身</p></OpsShellV8>)
    })
    for (const label of ['ダッシュボード', '契約先アカウント', 'お問い合わせ', 'お知らせ', 'ナレッジ', '監査ログ', 'メンバー管理', '2要素認証']) {
      expect(text()).toContain(label)
    }
    expect(text()).toContain('運営 › メンバー管理')
    expect(document.querySelector('a[aria-current="page"]')?.textContent).toContain('メンバー管理')
  })
})

describe('閲覧のみには押せないボタンを置かない', () => {
  it('メンバー管理：書ける人には招待と停止、閲覧のみには出さない', async () => {
    await act(async () => { root.render(<OpsMembersV8 />) })
    await settle()
    expect(buttons('招待メールを送る')).toHaveLength(1)
    expect(buttons('停止')).toHaveLength(1)

    act(() => root.unmount())
    readOnly = true
    root = createRoot(host)
    await act(async () => { root.render(<OpsMembersV8 />) })
    await settle()
    expect(text()).toContain('見本 次郎')
    expect(buttons('招待メールを送る')).toHaveLength(0)
    expect(buttons('停止')).toHaveLength(0)
  })

  it('契約先アカウント：閲覧のみには「契約先を作る」を出さない', async () => {
    readOnly = true
    await act(async () => { root.render(<OpsTenantsV8 />) })
    await settle()
    expect(text()).toContain('契約先A')
    expect(buttons('契約先を作る')).toHaveLength(0)
  })
})

describe('送る・止める前に確かめる', () => {
  it('お知らせ：今すぐ送るを押すと確認の窓が開き、まだ送らない', async () => {
    await act(async () => { root.render(<OpsAnnouncementsV8 />) })
    await settle()
    const send = buttons('今すぐ送る')[0] as HTMLButtonElement
    expect(send).toBeTruthy()
    await act(async () => { send.click() })
    await settle()
    expect(text()).toContain('このお知らせを送りますか？')
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/ops/announcements'))).toHaveLength(0)
  })

  it('契約先の停止：名前と理由がそろう前はボタンがあっても口を呼ばず、足りないものを知らせる', async () => {
    search = 'id=t1'
    await act(async () => { root.render(<OpsTenantDetailV8 />) })
    await settle()
    await act(async () => { (buttons('停止')[0] as HTMLButtonElement).click() })
    await settle()
    const confirm = buttons('停止する')[0] as HTMLButtonElement
    expect(confirm).toBeTruthy()
    await act(async () => { confirm.click() })
    await settle()
    expect(text()).toContain('契約先の名前をそのまま入力してください')
    expect(calls.some((c) => c.method !== 'GET' && c.url.includes('/status'))).toBe(false)
  })
})
