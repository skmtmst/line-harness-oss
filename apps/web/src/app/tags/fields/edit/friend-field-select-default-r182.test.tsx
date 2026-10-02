// @vitest-environment happy-dom
/*
 * R182: 単一選択の既定値は選択肢名で見せる。
 * 以前は保存済みの内部IDが欄にそのまま出て、Bを選んだことが読めなかった。
 * IDで保存された既定値が「B」と表示され、そのまま保存できることを確かめる。
 */
import React from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const mockState = vi.hoisted(() => ({
  payload: null as Record<string, unknown> | null,
  field: {
    id: 'ff-1',
    name: '好きなもの',
    fieldKey: 'favorites',
    type: 'select',
    options: ['A', 'B'],
    optionDefinitions: [
      { id: 'uuid-a', label: 'A' },
      { id: 'uuid-b', label: 'B' },
    ],
    defaultValue: 'uuid-b',
    isPersonal: false,
    isStarred: false,
    ecIsMaster: false,
    ecFieldPath: null,
    folderId: null,
    version: 1,
  },
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    folders: { list: () => Promise.resolve({ success: true, data: [] }) },
    friendFields: {
      list: () => Promise.resolve({ success: true, data: [mockState.field] }),
      update: (_id: string, _account: string, data: Record<string, unknown>) => {
        mockState.payload = data
        return Promise.resolve({ success: true, data: { id: 'ff-1' } })
      },
    },
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams('?id=ff-1'),
}))

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'a1', selectedAccount: { id: 'a1', name: '店舗A' } }),
}))

vi.mock('@/lib/use-feature-visibility', () => ({
  useFeatureVisibility: () => ({ status: 'ready', features: {}, enabled: () => true }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('R182 単一選択の既定値', () => {
  test('保存済みのIDは選択肢名「B」で表示される', async () => {
    const { default: EditFriendFieldPage } = await import('./page')
    render(<EditFriendFieldPage />)
    const trigger = await screen.findByRole('button', { name: '既定値' })
    expect(trigger.textContent).toContain('B')
    expect(trigger.textContent).not.toContain('uuid-b')
  })

  test('変えずに保存すると選択肢名で送られる', async () => {
    const { default: EditFriendFieldPage } = await import('./page')
    render(<EditFriendFieldPage />)
    await screen.findByRole('button', { name: '既定値' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    })
    expect(mockState.payload).not.toBeNull()
    expect(mockState.payload?.defaultValue).toBe('B')
  })
})
