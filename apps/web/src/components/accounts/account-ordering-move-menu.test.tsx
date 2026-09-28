// @vitest-environment happy-dom
/*
 * R191: アカウント階層の移動先メニュー（ドラッグを使わない操作経路）。
 *
 * カードの「…」から「最上位（親）にする」「「X」の子にする」を選ぶだけで
 * ドラッグと同じ下書きができ、循環・階層上限の行き先は理由つきで
 * 押せない。実物の React をマウントして操作する。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  updateHierarchy: vi.fn(() => Promise.resolve({ success: true })),
  accounts: [
    { id: 'a', name: '本店', displayName: '本店', parentLineAccountId: null },
    { id: 'b', name: '支店', displayName: '支店', parentLineAccountId: 'a' },
    { id: 'c', name: '出張所', displayName: '出張所', parentLineAccountId: 'b' },
    { id: 'd', name: '新規店', displayName: '新規店', parentLineAccountId: null },
  ],
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    lineAccounts: {
      list: () => Promise.resolve({ success: true, data: fixture.accounts }),
      updateHierarchy: fixture.updateHierarchy,
    },
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {}, replace: () => {}, refresh: () => {},
    back: () => {}, forward: () => {}, prefetch: () => {},
  }),
  usePathname: () => '/accounts',
}))

import AccountOrdering from './account-ordering'

beforeEach(() => {
  fixture.updateHierarchy.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const openMoveMenu = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `${name}の移動先を選ぶ` }))
  return screen.findByRole('menu', { name: `${name}の移動先` })
}

describe('R191 階層の移動先をキーボード・クリックで選べる', () => {
  test('未設定カードの「…」から「子」への配置が下書きできる', async () => {
    render(<AccountOrdering />)
    const menu = await openMoveMenu('新規店')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /「本店」の子にする/ }))

    // 新規店が本店の子として下書きに入り、未保存の印が出る
    await screen.findByText(/未保存の変更 1件/)
    const newKid = document.querySelector('[data-account-id="d"]')
    // 子位置（一段下げ）の折返し容器に入る
    expect(newKid?.parentElement?.className).toContain('ml-8')
  })

  test('「最上位（親）にする」で下位から抜けられる', async () => {
    render(<AccountOrdering />)
    const menu = await openMoveMenu('支店')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /最上位（親）にする/ }))
    await screen.findByText(/未保存の変更/)
  })

  test('循環する行き先は理由つきで押せない', async () => {
    render(<AccountOrdering />)
    const menu = await openMoveMenu('本店')
    const cycle = within(menu).getByRole('menuitem', { name: /「支店」の子にする/ })
    expect((cycle as HTMLButtonElement).disabled).toBe(true)
    // 「支店」「出張所」どちらも本店の下位なので、循環の理由は複数出る。
    expect(within(menu).getAllByText(/循環/).length).toBeGreaterThan(0)
  })

  test('3階層を超える行き先は理由つきで押せない', async () => {
    render(<AccountOrdering />)
    const menu = await openMoveMenu('新規店')
    // 「出張所」は「孫」の位置。その下は4階層目になるので置けない。
    const tooDeep = within(menu).getByRole('menuitem', { name: /「出張所」の子にする/ })
    expect((tooDeep as HTMLButtonElement).disabled).toBe(true)
    expect(within(menu).getByText(/3階層まで/)).toBeTruthy()
  })

  test('メニューで下書きした変更を保存できる', async () => {
    render(<AccountOrdering />)
    const menu = await openMoveMenu('新規店')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /「本店」の子にする/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /並びを保存/ })[0])
    await vi.waitFor(() => {
      expect(fixture.updateHierarchy).toHaveBeenCalledWith([
        { id: 'd', parentLineAccountId: 'a' },
      ])
    })
  })
})
