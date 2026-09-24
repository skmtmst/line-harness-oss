// @vitest-environment happy-dom
/*
 * 全ルート監査 A1（2026-09-25）: `/recipes/clone` を id なしで開くと
 * `recipe.items.map` で「画面を表示できませんでした」になっていた。
 * id が無いときは取らずに TargetMissing（unspecified）で
 * 「作るレシピが指定されていません」と「レシピ一覧へ戻る」を出す。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const apiGet = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { recipes: { get: (...args: unknown[]) => apiGet(...args) } } }))

import Page from './page'

const flush = () => act(async () => { await Promise.resolve() })

afterEach(cleanup)

describe('recipes/clone の id なし', () => {
  it('取りに行かず「作るレシピが指定されていません」と一覧への戻りを出す', async () => {
    apiGet.mockResolvedValue({ success: true, data: { items: [], total: 0, page: 1, limit: 20 } })
    render(<Page />)
    await flush()
    expect(apiGet).not.toHaveBeenCalled()
    expect(await screen.findByText('作るレシピが指定されていません')).toBeTruthy()
    const back = screen.getByRole('link', { name: 'レシピ一覧へ戻る' })
    expect(back.getAttribute('href')).toBe('/recipes')
  })
})
