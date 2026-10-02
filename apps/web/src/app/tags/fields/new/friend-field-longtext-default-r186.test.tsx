// @vitest-environment happy-dom
/*
 * R186: 複数行テキストの既定値は複数行で入れる。
 * 以前は1行欄で改行が入力時に消え、「1行目2行目」として保存されていた。
 * 改行を残して送ることを、実物の画面で確かめる。
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

describe('R186 複数行テキストの既定値', () => {
  test('既定値欄が複数行で、改行を残して送られる', async () => {
    const { default: NewFriendFieldPage } = await import('./page')
    render(<NewFriendFieldPage />)
    await screen.findByLabelText(/項目名/)

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/項目名/), { target: { value: 'あいさつ文' } })
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/差し込み名/), { target: { value: 'greeting' } })
    })
    await chooseType('複数行テキスト')

    const defaultField = screen.getByLabelText('既定値') as HTMLTextAreaElement
    expect(defaultField.tagName.toLowerCase()).toBe('textarea')
    await act(async () => {
      fireEvent.change(defaultField, { target: { value: '1行目\n2行目' } })
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '項目を作る' }))
    })

    expect(mockState.payload).not.toBeNull()
    expect(mockState.payload?.defaultValue).toBe('1行目\n2行目')
  })
})
