// @vitest-environment happy-dom
/* 登録・接続確認はオーナーと管理者。スタッフ・閲覧のみは入口も直アクセスも拒否する。 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  role: { value: 'owner' as string | null },
  list: vi.fn(),
}))

vi.mock('@/lib/staff-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/staff-role')>()),
  useStaffRole: () => fixture.role.value,
}))

vi.mock('@/components/shell/page-chrome', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/shell/page-chrome')>()),
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'acc-1', selectedAccount: null, accounts: [] }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/accounts',
  useSearchParams: () => new URLSearchParams(),
}))

// 一覧の取得だけ差し替える。スタイルの入口など他の口は本物のまま（部分差し替え）。
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, lineAccounts: { ...actual.api.lineAccounts, list: fixture.list } } }
})

import AccountsV8 from './accounts'

beforeEach(() => {
  vi.clearAllMocks()
  fixture.role.value = 'owner'
  fixture.list.mockResolvedValue({ success: true, data: [] })
  // スタイルの入口など本物のままの口が外へ出ていかないようにする（試験は網を使わない）。
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"success":true,"data":null}', {
    status: 200, headers: { 'content-type': 'application/json' },
  })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const MANAGER_ONLY = 'LINEアカウントの登録はオーナーか管理者ができます'

async function open() {
  render(<AccountsV8 />)
  await act(async () => {})
}

describe('一覧の登録権限', () => {
  it.each(['staff', 'viewer'])('%s には登録の入口を出さず、頼む先を書く', async (role) => {
    fixture.role.value = role
    await open()
    expect(screen.queryByRole('link', { name: /LINEアカウントを登録/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /LINEアカウントを登録/ })).toBeNull()
    expect(screen.getByText('送受信に使うアカウントの登録はオーナーか管理者ができます。オーナーか管理者に頼んでください。')).toBeTruthy()
  })

  it('管理者から並び順と親子は取り上げない（account.metadata.edit）', async () => {
    fixture.role.value = 'admin'
    await open()
    expect(screen.getByRole('button', { name: /並び順と親子を変える/ })).toBeTruthy()
  })

  it.each(['staff', 'viewer'])('1件も無いときも %s には頼む先を出す', async (role) => {
    fixture.role.value = role
    await open()
    expect(screen.getByText('送受信に使うアカウントの登録はオーナーか管理者ができます。オーナーか管理者に頼んでください。')).toBeTruthy()
  })

  it.each(['owner', 'admin'])('%s は空の一覧から登録を開始できる', async (role) => {
    fixture.role.value = role
    await open()
    expect(screen.getAllByRole('link', { name: /LINEアカウントを登録/ }).length).toBe(2)
    expect(screen.queryByText(MANAGER_ONLY)).toBeNull()
  })
})
