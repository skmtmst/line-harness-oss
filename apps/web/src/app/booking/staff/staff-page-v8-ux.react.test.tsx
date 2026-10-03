// @vitest-environment happy-dom
/*
 * 担当スタッフ一覧の「サクサク感」（V8 のときだけ）。
 * A: 読み込み中は目に見える「読み込み中」の文字を置かず、表の形の骨組みで待つ。
 * B: 編集窓の保存ボタンは押した直後に内側だけ「保存中…」へ変わる。
 * v7 は従来の見た目のまま（この試験では触らない）。
 */
import React from 'react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  listStaff: null as null | (() => Promise<unknown>),
  createStaff: null as null | ((...args: unknown[]) => Promise<unknown>),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', accounts: [] }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => undefined }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/api', () => ({
  api: { staff: { list: async () => ({ success: true, data: [] }) } },
  bookingApi: {
    listStaff: (...args: unknown[]) => fixture.listStaff!(...(args as [])),
    createStaff: (...args: unknown[]) => fixture.createStaff!(...(args as [])),
    updateStaff: vi.fn(async () => ({ ok: true })),
    deleteStaff: vi.fn(async () => ({ ok: true })),
  },
}))

const memStorage = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
  }
})
vi.stubGlobal('localStorage', memStorage)

import BookingStaffPage from './page'

const ROW = {
  id: 'staff-a', name: 'yamada', display_name: '山田', role: 'スタイリスト',
  profile_image_url: '', bio: '', sort_order: 0,
  is_designation_optional: 0, is_active: 1,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  memStorage.setItem('lh_staff_role', 'owner')
  document.documentElement.dataset.theme = 'v8'
  fixture.listStaff = async () => ({ staff: [ROW] })
  fixture.createStaff = vi.fn(async () => ({ ok: true }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete document.documentElement.dataset.theme
})

describe('担当一覧（V8）の読み込みと保存ボタン', () => {
  test('読み込み中は文字を出さず表の形の骨組みで待つ', async () => {
    const gate = deferred<unknown>()
    fixture.listStaff = () => gate.promise
    render(<BookingStaffPage />)

    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
    // 目に見える文字は置かない（読み上げ用の1文だけ残す）。
    // 骨組みは0.3秒待ってから出る。
    const loadingTexts = screen.queryAllByText('予約スタッフを読み込んでいます')
    expect(loadingTexts.length).toBe(1)
    expect(loadingTexts[0].className).toContain('sr-only')
    await waitFor(() => { expect(document.querySelector('[data-skeleton]')).toBeTruthy() })

    await act(async () => { gate.resolve({ staff: [ROW] }) })
    expect(await screen.findByText('山田')).toBeTruthy()
  })

  test('新規作成の保存ボタンは押すと内側だけ保存中に変わる', async () => {
    const gate = deferred<unknown>()
    fixture.createStaff = vi.fn(() => gate.promise)
    render(<BookingStaffPage />)
    await screen.findByText('山田')

    fireEvent.click(screen.getByRole('button', { name: '＋ スタッフを作る' }))
    fireEvent.change(screen.getByPlaceholderText('例: yamada-taro'), { target: { value: 'sato' } })
    fireEvent.change(screen.getByPlaceholderText('顧客に表示される名前'), { target: { value: '佐藤' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    expect(await screen.findByRole('button', { name: '保存中…' })).toBeTruthy()

    await act(async () => { gate.resolve({ ok: true }) })
    await waitFor(() => { expect(fixture.createStaff).toHaveBeenCalled() })
  })
})
