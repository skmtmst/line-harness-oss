// @vitest-environment happy-dom
/*
 * R139: 複数選択の既定値は登録済みの選択肢から複数選んで配列で保存する。
 * 以前は文字列欄しかなく「選択肢IDの配列で指定してください」で保存失敗した。
 * AとBを選んで保存し、配列で送られることを確かめる。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const mockState = vi.hoisted(() => ({
  payload: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    folders: { list: () => Promise.resolve({ success: true, data: [] }) },
    friendFields: {
      list: () => Promise.resolve({ success: true, data: [] }),
      create: (_account: string, data: Record<string, unknown>) => {
        mockState.payload = data
        return Promise.resolve({ success: true, data: { id: 'ff-1' } })
      },
    },
    featureSettings: {
      visibility: () => Promise.resolve({ success: true, data: { features: {} } }),
    },
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/tags/fields/new',
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'a1', selectedAccount: { id: 'a1', name: '店舗A' } }),
}))

vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready', features: { friend_fields: true }, enabled: () => true }),
}))

beforeEach(() => {
  mockState.payload = null
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function chooseType(label: string) {
  const trigger = screen.getByRole('button', { name: '友だち情報欄の種類' })
  await act(async () => {
    fireEvent.click(trigger)
  })
  const option = await screen.findByRole('button', { name: label })
  await act(async () => {
    fireEvent.click(option)
  })
}

describe('R139 複数選択の既定値', () => {
  test('AとBを選んで保存すると配列で送られる', async () => {
    const { default: NewFriendFieldPage } = await import('./page')
    render(<NewFriendFieldPage />)
    await screen.findByLabelText(/項目名/)

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/項目名/), { target: { value: '好きなもの' } })
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/差し込み名/), { target: { value: 'favorites' } })
    })
    await chooseType('複数選択')

    const options = screen.getByLabelText(/選択肢/)
    await act(async () => {
      fireEvent.change(options, { target: { value: 'A\nB' } })
    })

    // 既定値でAとBを選ぶ。
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'B' }))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '項目を作成' }))
    })

    expect(mockState.payload).not.toBeNull()
    expect(mockState.payload?.defaultValue).toEqual(['A', 'B'])
  })

  test('何も選ばなければ既定値なし（null）で送られる', async () => {
    const { default: NewFriendFieldPage } = await import('./page')
    render(<NewFriendFieldPage />)
    await screen.findByLabelText(/項目名/)

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/項目名/), { target: { value: '好きなもの' } })
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/差し込み名/), { target: { value: 'favorites' } })
    })
    await chooseType('複数選択')
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/選択肢/), { target: { value: 'A\nB' } })
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '項目を作成' }))
    })

    expect(mockState.payload?.defaultValue).toBeNull()
  })
})
