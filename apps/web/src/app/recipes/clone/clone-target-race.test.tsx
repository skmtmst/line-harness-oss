// @vitest-environment happy-dom
/*
 * 監査 WEB321：レシピを A→B と移ったとき、A の遅い応答（読み込み）で
 * B の画面を書き換えない。
 */
import React from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ id: 'recipe-a', pending: new Map<string, (v: unknown) => void>() }))
const titleFn = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`id=${net.id}`) }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
/* 73: レシピ名は板の中のパンくずではなく上の帯の題へ出す。世代の判定は題で見る。 */
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: (...args: unknown[]) => titleFn(...args), usePageCrumbs: vi.fn() }))
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
    await waitFor(() => expect(titleFn).toHaveBeenCalledWith('Bのレシピを作る'))
    await act(async () => { net.pending.get('recipe-a')?.({ success: true, data: recipe('recipe-a', 'Aのレシピ') }) })
    expect(titleFn).not.toHaveBeenCalledWith('Aのレシピを作る')
    expect(titleFn).toHaveBeenLastCalledWith('Bのレシピを作る')
  })
})
