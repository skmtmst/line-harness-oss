// @vitest-environment happy-dom
/*
 * V8 統括のメンバー（src/v8/hq/members.tsx・member-dialog.tsx）の動きの試験。
 * 招待の始まり（閲覧のみ・指定したアカウントだけ・アーカイブは選ばせない）、
 * 変更→確認（M4jS9）の間は変更の窓を閉じる、確認をやめたら中身のまま戻る、
 * 役割を変えないときは役割を送らない（担当者が管理者に上がらない）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

const me = vi.hoisted(() => vi.fn())
const list = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
const create = vi.hoisted(() => vi.fn())
const accounts = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      staff: {
        ...actual.api.staff,
        me,
        list,
        update,
        create,
        lastLogins: vi.fn(async () => ({ success: true, data: {} })),
        resendInvite: vi.fn(),
      },
      lineAccounts: { ...actual.api.lineAccounts, list: accounts },
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/hq/members',
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))

import HqMembersV8 from './members'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const staffMember = {
  id: 'stf-staff', name: '中川 由美', email: 'nakagawa@example.com', role: 'staff', isActive: true,
  inviteStatus: 'active', accountScope: 'accounts', scopedLineAccountIds: ['acc-1'], assignedLineAccountId: 'acc-1',
  permissionKeys: [], notificationPreferences: {}, lineLinked: true, twoFactorEnabled: false,
  canAccessDescendantAccounts: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}

let root: Root | null = null
let host: HTMLDivElement

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() }) }
const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === text) as HTMLButtonElement | undefined
const dialogTitles = () => Array.from(document.querySelectorAll('[role="dialog"] h2')).map((h) => h.textContent)

beforeEach(async () => {
  me.mockResolvedValue({ success: true, data: { id: 'owner', name: 'Kenta', role: 'owner', accountScope: 'all' } })
  list.mockResolvedValue({ success: true, data: [staffMember] })
  update.mockResolvedValue({ success: true, data: staffMember })
  create.mockResolvedValue({ success: true, data: staffMember })
  accounts.mockResolvedValue({ success: true, data: [
    { id: 'acc-1', name: '然 -NEN- 本店', displayOrder: 0 },
    { id: 'acc-2', name: '然 -NEN- 渋谷店', displayOrder: 1 },
    { id: 'acc-old', name: '旧キャンペーン', displayOrder: 2, archivedAt: '2026-01-01T00:00:00Z' },
  ] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(<HqMembersV8 />) })
  await flush()
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('V8 統括のメンバーの窓', () => {
  it('招待は閲覧のみ・指定したアカウントだけから始め、アーカイブしたアカウントは選ばせない', async () => {
    await act(async () => { buttonByText('権限者を招待')!.click() })
    await flush()
    expect(dialogTitles()).toContain('権限者を招待')
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="radio"]'))
    expect(radios.find((r) => r.value === 'accounts')?.checked).toBe(true)
    const checks = Array.from(document.querySelectorAll('[role="dialog"] [aria-label="担当するアカウント"] label')).map((l) => l.textContent)
    expect(checks).toEqual(['然 -NEN- 本店', '然 -NEN- 渋谷店'])
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('閲覧のみ（見るだけ）')
  })

  it('確認の間は変更の窓を閉じ、やめたら入れた中身のまま戻り、役割を変えないときは役割を送らない', async () => {
    await act(async () => { buttonByText('中川 由美さんの権限を変更')!.click() })
    await flush()
    expect(dialogTitles()).toEqual(['メンバーの権限を変更する'])
    // 担当者のまま。状態だけ無効にする。
    const inactive = Array.from(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="radio"]')).find((r) => r.value === 'inactive')!
    await act(async () => { inactive.click() })
    await act(async () => { buttonByText('変更を保存')!.click() })
    await flush()
    expect(dialogTitles()).toEqual(['中川 由美 さんの権限を変えますか？'])

    await act(async () => { buttonByText('キャンセル')!.click() })
    await flush()
    expect(dialogTitles()).toEqual(['メンバーの権限を変更する'])
    const stillInactive = Array.from(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="radio"]')).find((r) => r.value === 'inactive')!
    expect(stillInactive.checked).toBe(true)

    await act(async () => { buttonByText('変更を保存')!.click() })
    await flush()
    await act(async () => { buttonByText('変える')!.click() })
    await flush()
    expect(update).toHaveBeenCalledTimes(1)
    const body = update.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('role')
    expect(body.isActive).toBe(false)
  })

  it('WEB216：統括（owner）の範囲だけを変えても、役割（owner→admin）を送らない', async () => {
    const ownerMember = { ...staffMember, id: 'stf-owner', name: '本部 太郎', role: 'owner', accountScope: 'all', scopedLineAccountIds: [] }
    list.mockResolvedValue({ success: true, data: [ownerMember, staffMember] })
    await act(async () => { root!.render(<HqMembersV8 key="again" />) })
    await flush()
    const edit = buttonByText('本部 太郎さんの権限を変更')
    expect(edit).toBeTruthy()
    await act(async () => { edit!.click() })
    await flush()
    const accountsOnly = Array.from(document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="radio"]')).find((r) => r.value === 'accounts')!
    await act(async () => { accountsOnly.click() })
    const firstAccount = document.querySelector<HTMLElement>('[role="dialog"] [aria-label="担当するアカウント"] input, [role="dialog"] [aria-label="担当するアカウント"] button[role="checkbox"]')!
    await act(async () => { firstAccount.click() })
    await act(async () => { buttonByText('変更を保存')!.click() })
    await flush()
    const confirm = buttonByText('変える')
    if (confirm) await act(async () => { confirm.click() })
    await flush()
    expect(update).toHaveBeenCalled()
    const body = update.mock.calls.at(-1)![1] as Record<string, unknown>
    expect(body).not.toHaveProperty('role')
  })
})

describe('V8 統括のメンバーの表の列（絵 r4ARpV・2026-10-08）', () => {
  it('名前の列は 160 で守り、伸び縮みするのはメールアドレスだけ', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const css = readFileSync(resolve(__dirname, 'members.module.css'), 'utf8')
    const globals = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8')
    const columns = css.match(/\.head,\s*\.row\s*\{[^}]*grid-template-columns:\s*([^;]+);/)?.[1].trim().split(/\s+(?![^(]*\))/)
    expect(columns).toEqual([
      'var(--tpl-hq-col-name)', 'minmax(0, 1fr)', 'var(--tpl-hq-col-role)', 'var(--tpl-hq-col-scope)',
      'var(--tpl-hq-col-state)', 'var(--tpl-hq-col-login)', 'var(--tpl-hq-col-action)',
    ])
    const value = (name: string) => globals.match(new RegExp(`--tpl-hq-col-${name}:\\s*([^;]+);`))?.[1]
    expect([value('name'), value('role'), value('scope'), value('state'), value('login'), value('action')])
      .toEqual(['160px', '80px', '110px', '80px', '90px', '80px'])
  })
})
