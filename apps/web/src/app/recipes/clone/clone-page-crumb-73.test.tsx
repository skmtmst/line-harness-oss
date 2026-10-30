// @vitest-environment happy-dom
/*
 * 73: 作る画面のパンくずは上の帯だけ。板の中に2つ目のパンくず（レシピ › 名前）を置かない。
 * レシピを複製する：題は共通の PageHeading、戻り先は上の帯のパンくず（レシピ）へ。
 */
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const crumbsFn = vi.hoisted(() => vi.fn())
const titleFn = vi.hoisted(() => vi.fn())
const apiGet = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('id=recipe-1') }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({
  usePageTitle: (...args: unknown[]) => titleFn(...args),
  usePageCrumbs: (...args: unknown[]) => crumbsFn(...args),
}))
vi.mock('@/lib/api', () => ({
  api: { recipes: { get: (...args: unknown[]) => apiGet(...args) } },
  ApiError: class ApiError extends Error {
    status = 0
  },
}))

import Page from './page'

const recipe = {
  id: 'recipe-1',
  name: '来店後フォロー',
  purpose: '',
  creates: '',
  version: 1,
  origin: 'builtin',
  requiredFeatures: [],
  missingFeatures: [],
  items: [{ kind: 'tag', name: '来店済み', note: '' }],
  itemCount: 1,
  cloneCount: 0,
}

const flush = () => act(async () => {
  await Promise.resolve()
  await Promise.resolve()
})

beforeEach(() => {
  apiGet.mockResolvedValue({ success: true, data: recipe })
})

afterEach(cleanup)

describe('73 レシピを複製する：板の中にパンくずを置かない', () => {
  it('題は共通の見出しで、板の中に2つ目のパンくずが無い', async () => {
    const { container } = render(<Page />)
    await flush()
    expect(await screen.findByText('レシピを複製する')).toBeTruthy()
    expect(container.querySelector('nav[aria-label="パンくず"], nav[aria-label="現在位置"]')).toBeNull()
  })

  it('戻り先は上の帯のパンくず（レシピ）へ渡す', async () => {
    render(<Page />)
    await flush()
    expect(await screen.findByText('レシピを複製する')).toBeTruthy()
    expect(crumbsFn).toHaveBeenCalledWith([{ label: 'レシピ', href: '/recipes' }])
    expect(titleFn).toHaveBeenCalledWith('来店後フォローを作る')
  })
})
