// @vitest-environment happy-dom
/*
 * 監査 R126: 作る操作の再クリックごとに新しい再送キーを出していた。
 * 作成は成功して応答だけ切れたとき、別キーの再送は同名競合で失敗し、
 * 作った結果を画面が取り戻せない。同じ作成意図（レシピ・宛先・名前の
 * あたま）のやり直しは同じキーを使い、入力が変わった時だけ新しいキーにする。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  clone: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('id=recipe-1') }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a', selectedAccount: null, loading: false }),
}))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/lib/api', () => ({
  api: {
    recipes: {
      get: (...args: unknown[]) => apiMocks.get(...args),
      clone: (...args: unknown[]) => apiMocks.clone(...args),
    },
  },
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
  apiMocks.get.mockResolvedValue({ success: true, data: recipe })
  apiMocks.clone.mockReset()
})

afterEach(cleanup)

describe('recipes/clone の再送キー (監査R126)', () => {
  it('応答が切れたあとのやり直しは同じキーで送る', async () => {
    apiMocks.clone.mockRejectedValue(new Error('network lost'))
    render(<Page />)
    await flush()

    const button = await screen.findByRole('button', { name: '1件を下書きで作る' })
    await act(async () => { fireEvent.click(button) })
    await act(async () => { fireEvent.click(button) })

    expect(apiMocks.clone).toHaveBeenCalledTimes(2)
    const firstKey = apiMocks.clone.mock.calls[0][2]
    const secondKey = apiMocks.clone.mock.calls[1][2]
    expect(firstKey).toBeTruthy()
    expect(secondKey).toBe(firstKey)
  })

  it('名前のあたまを変えたら別の依頼として新しいキーにする', async () => {
    apiMocks.clone.mockRejectedValue(new Error('network lost'))
    render(<Page />)
    await flush()

    const button = await screen.findByRole('button', { name: '1件を下書きで作る' })
    await act(async () => { fireEvent.click(button) })

    const input = screen.getByLabelText(/名前のあたまに付ける文字/)
    await act(async () => { fireEvent.change(input, { target: { value: '2026春' } }) })
    await act(async () => { fireEvent.click(button) })

    expect(apiMocks.clone).toHaveBeenCalledTimes(2)
    expect(apiMocks.clone.mock.calls[1][2]).not.toBe(apiMocks.clone.mock.calls[0][2])
    expect(apiMocks.clone.mock.calls[1][1]).toMatchObject({ namePrefix: '2026春' })
  })
})
