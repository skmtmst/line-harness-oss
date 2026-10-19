// @vitest-environment happy-dom
/*
 * LINEアカウントの登録はオーナーだけ（要件 v6-33 §15 `account.line.register`「登録、接続確認」）。
 *
 * 管理者が /accounts/new をそのまま開けてしまい、③接続確認で［もう一度確かめる］を
 * 押した瞬間にサーバの403で行き止まりになっていた（2026-10-18 利用者報告）。
 * しかも403の文が「オーナーか管理者に頼んでください」で、管理者が自分自身に
 * 頼む言い方になっていた。直したのは画面側だけで、サーバの owner 限定は要件どおり。
 *
 * ここで見るのは3つ。
 *  - 管理者には手順を出さず、オーナーだけの操作だと分かる案内と戻る道を出す
 *  - オーナーには今までどおり手順を出す
 *  - 役割がまだ読めていない間は読込みを表示し、権限の案内も手順も出さない。
 *    下書きの復元・変更の処理は権限が確定するまで始めない。
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ role: { value: 'owner' as string | null } }))
const styleCalls = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/api-styles', () => ({ styleApi: styleCalls }))

vi.mock('@/lib/staff-role', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/staff-role')>()),
  useStaffRole: () => fixture.role.value,
}))

vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: () => {},
  usePageCrumbs: () => {},
}))

vi.mock('@/lib/api', () => ({
  api: { lineAccounts: { connectCheck: vi.fn(), connect: vi.fn(), list: vi.fn(async () => ({ success: true, data: [] })) } },
  ApiError: class ApiError extends Error { status = 0 },
  describeSaveFailure: () => '',
}))

import AccountRegisterV8 from './register'

beforeEach(() => { fixture.role.value = 'owner'; vi.clearAllMocks() })
afterEach(cleanup)

const OWNER_ONLY = 'LINEアカウントの登録はオーナーだけができます。オーナーに頼んでください。'

describe('/accounts/new はオーナーだけ', () => {
  it('管理者には手順を出さず、頼む先と一覧へ戻る道を出す', () => {
    fixture.role.value = 'admin'
    render(<AccountRegisterV8 />)
    expect(screen.getByText(OWNER_ONLY)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'LINEアカウントの一覧へ戻る' })).toBeTruthy()
    // ①の手順そのものが出ていないこと（押せる入口を残さない）。
    expect(screen.queryByText('Step 1 / 3')).toBeNull()
  })

  it('閲覧のみにも同じ案内を出す', () => {
    fixture.role.value = 'viewer'
    render(<AccountRegisterV8 />)
    expect(screen.getByText(OWNER_ONLY)).toBeTruthy()
  })

  it('オーナーには今までどおり手順を出す', () => {
    fixture.role.value = 'owner'
    render(<AccountRegisterV8 />)
    expect(screen.queryByText(OWNER_ONLY)).toBeNull()
    expect(screen.getByRole('heading', { name: 'ご利用環境の確認' })).toBeTruthy()
  })

  it('役割が読めるまでは読込みを示し、権限の案内も手順も出さない', () => {
    fixture.role.value = null
    render(<AccountRegisterV8 />)
    expect(screen.queryByText(OWNER_ONLY)).toBeNull()
    expect(screen.getByLabelText('権限を確認しています').getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(styleCalls.get).not.toHaveBeenCalled()
    expect(styleCalls.save).not.toHaveBeenCalled()
  })
})
