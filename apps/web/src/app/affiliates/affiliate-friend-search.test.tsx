// @vitest-environment happy-dom
/*
 * R294: 紹介者作成の友だち検索が0件でも「該当なし」を案内する。
 * 検索中・結果あり・0件・失敗を言い分けて、失敗は再試行できる。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

const fixture = vi.hoisted(() => ({
  listImpl: null as null | ((params: unknown) => Promise<unknown>),
}))

vi.mock('@/lib/api', () => ({
  api: {
    friends: {
      list: (params: unknown) => fixture.listImpl!(params),
    },
    affiliates: {
      create: async () => ({ success: true, data: {}, link: null }),
    },
  },
}))

const { CreateAffiliateModal } = await import('./tabs')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

function typeSearch(value: string) {
  fireEvent.change(screen.getByPlaceholderText('名前で検索...'), { target: { value } })
}

async function settleDebounce() {
  await act(async () => { vi.advanceTimersByTime(300) })
}

describe('R294 友だち検索の0件・失敗を案内する', () => {
  test('0件でも候補枠が開いたまま「該当なし」が出る', async () => {
    fixture.listImpl = async () => ({ success: true, data: { items: [] } })
    render(
      <CreateAffiliateModal accountId="acc-1" onClose={() => {}} onCreated={() => {}} />,
    )
    typeSearch('QA_R69_NO_MATCH')
    await settleDebounce()
    await screen.findByText('該当なし。検索語を変えてお試しください。')
    // 作成は押せないまま。
    expect((screen.getByRole('button', { name: '作る' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('失敗は「読み込めませんでした」と再試行。直れば候補が出る', async () => {
    fixture.listImpl = async () => ({ success: false, error: '落ちた' })
    render(
      <CreateAffiliateModal accountId="acc-1" onClose={() => {}} onCreated={() => {}} />,
    )
    typeSearch('Kenta')
    await settleDebounce()
    await screen.findByText('候補を読み込めませんでした')

    // 直して「もう一度試す」を押すと候補が出る。
    fixture.listImpl = async () => ({
      success: true,
      data: { items: [{ id: 'friend-kenta', displayName: 'Kenta Kawano(Obama)' }] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }))
    await settleDebounce()
    await screen.findByText('Kenta Kawano(Obama)')
  })

  test('候補ありは選べて、入力を消すと枠が閉じる', async () => {
    fixture.listImpl = async () => ({
      success: true,
      data: { items: [{ id: 'friend-kenta', displayName: 'Kenta Kawano(Obama)' }] },
    })
    render(
      <CreateAffiliateModal accountId="acc-1" onClose={() => {}} onCreated={() => {}} />,
    )
    typeSearch('Kenta')
    await settleDebounce()
    const option = await screen.findByText('Kenta Kawano(Obama)')
    fireEvent.click(option)
    // 選んだら作成できる。
    expect((screen.getByRole('button', { name: '作る' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
