// @vitest-environment happy-dom
/*
 * 監査 WEB321：レシピを A→B と移ったとき、A の遅い応答（読み込み）で
 * B の画面を書き換えない。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ id: 'recipe-a', pending: new Map<string, (v: unknown) => void>() }))

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`id=${net.id}`) }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: {
    recipes: {
      get: (id: string) => new Promise((resolve) => { net.pending.set(id, resolve) }),
      clone: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    status = 0
  },
}))

import Page from './page'

const recipe = (id: string, name: string) => ({
  id, name, purpose: '', creates: '', version: 1, origin: 'builtin', requiredFeatures: [],
  missingFeatures: [], items: [{ kind: 'tag', name: '来店済み', note: '' }], itemCount: 1, cloneCount: 0,
})

afterEach(cleanup)

describe('recipes/clone の対象の世代（WEB321）', () => {
  it('B を開いたあとに A の読み込みが届いても、B のまま', async () => {
    const view = render(<Page />)
    net.id = 'recipe-b'
    view.rerender(<Page />)
    await act(async () => { net.pending.get('recipe-b')?.({ success: true, data: recipe('recipe-b', 'Bのレシピ') }) })
    await waitFor(() => expect(screen.getAllByText('Bのレシピ').length).toBeGreaterThan(0))
    await act(async () => { net.pending.get('recipe-a')?.({ success: true, data: recipe('recipe-a', 'Aのレシピ') }) })
    expect(screen.queryByText('Aのレシピ')).toBeNull()
  })
})
