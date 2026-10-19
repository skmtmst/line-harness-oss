// @vitest-environment happy-dom
/*
 * 設定 › LINEアカウントの［＋ LINEアカウントを登録］はオーナーだけ
 * （要件 v6-33 §15 `account.line.register`「登録、接続確認」）。
 *
 * 管理者にも入口を出していたため、押して③まで進んだところでサーバの403に当たり
 * 行き止まりになっていた（2026-10-18 利用者報告）。押せない入口を出すより、
 * 誰に頼めばよいかを先に書く——mcp-connect の「オーナーだけが作れます」と同じ作り。
 *
 * 一方で並び順と親子・スタイルは `account.metadata.edit`（owner、admin）なので、
 * 管理者から取り上げない。ここを一緒に隠さないことまで見る。
 */
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

const OWNER_ONLY = 'LINEアカウントの登録はオーナーだけができます'

async function open() {
  render(<AccountsV8 />)
  await act(async () => {})
}

describe('一覧の登録の入口はオーナーだけ', () => {
  it('管理者には登録の入口を出さず、頼む先を書く', async () => {
    fixture.role.value = 'admin'
    await open()
    expect(screen.queryByRole('link', { name: /LINEアカウントを登録/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /LINEアカウントを登録/ })).toBeNull()
    expect(screen.getByText(OWNER_ONLY)).toBeTruthy()
  })

  it('管理者から並び順と親子は取り上げない（account.metadata.edit）', async () => {
    fixture.role.value = 'admin'
    await open()
    expect(screen.getByRole('button', { name: /並び順と親子を変える/ })).toBeTruthy()
  })

  it('1件も無いときも、管理者には押せない入口でなく頼む先を出す', async () => {
    fixture.role.value = 'admin'
    await open()
    expect(screen.getByText('送受信に使うアカウントの登録はオーナーだけができます。オーナーに頼んでください。')).toBeTruthy()
  })

  it('オーナーには今までどおり登録の入口を出す', async () => {
    fixture.role.value = 'owner'
    await open()
    expect(screen.getAllByRole('link', { name: /LINEアカウントを登録/ }).length).toBeGreaterThan(0)
    expect(screen.queryByText(OWNER_ONLY)).toBeNull()
  })
})
