// @vitest-environment happy-dom
/*
 * R23: リッチメニュー作成のタグ候補は、いま選んでいるアカウントのものだけ。
 * 本物のReactで動かして見る。
 * - タグ一覧の取得に選択accountが付く（別アカウントの同名タグが混ざらない）
 * - アカウントを切り替えたら、前の候補にしかない選択を外して知らせる
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const accountState = { id: 'acc-1' }
// 描画ごとに同じ参照を返す（本物のProviderと同じ）。新しい字面を作ると
// selectedAccount の同一性が変わり、取得処理が無限に回る。
const ACCOUNTS: Record<string, { id: string; name: string }> = {
  'acc-1': { id: 'acc-1', name: '店舗A' },
  'acc-2': { id: 'acc-2', name: '店舗B' },
}

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: accountState.id,
    selectedAccount: ACCOUNTS[accountState.id],
    loading: false,
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(''),
}))

import NewRichMenuPage from './page'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const fetchUrls: string[] = []

const TAGS_BY_ACCOUNT: Record<string, Array<{ id: string; name: string }>> = {
  'acc-1': [{ id: 'tag-a1', name: '会員' }],
  'acc-2': [{ id: 'tag-b2', name: '予約' }],
}

function stubFetch() {
  fetchUrls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const text = String(url)
    fetchUrls.push(text)
    const parsed = new URL(text, 'http://localhost')
    if (parsed.pathname === '/api/tags') {
      const accountId = parsed.searchParams.get('lineAccountId')
      return { ok: true, status: 200, json: async () => ({ success: true, data: accountId ? (TAGS_BY_ACCOUNT[accountId] ?? []) : [] }) }
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
  }))
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

function combobox(): HTMLElement {
  const fields = Array.from(host.querySelectorAll('[role="combobox"]'))
  const tagField = fields.find((el) => el.getAttribute('aria-label') === 'タグを付ける')
  if (!tagField) throw new Error('タグの選択欄が見つかりません')
  return tagField as HTMLElement
}

describe('R23 作成画面のタグ候補は選択accountで絞る', () => {
  beforeEach(() => {
    accountState.id = 'acc-1'
    stubFetch()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    host.remove()
    vi.unstubAllGlobals()
  })

  it('タグ一覧の取得に選択accountが付く', async () => {
    await act(async () => {
      root.render(<NewRichMenuPage />)
    })
    await settle(100)
    const tagUrls = fetchUrls.filter((url) => new URL(url, 'http://localhost').pathname === '/api/tags')
    expect(tagUrls.length).toBeGreaterThan(0)
    for (const url of tagUrls) {
      expect(url).toContain('lineAccountId=acc-1')
    }
  })

  it('切り替えたら前の候補にしかない選択を外して知らせる', async () => {
    await act(async () => {
      root.render(<NewRichMenuPage />)
    })
    await settle(100)
    // 1面目の動きを開き、acc-1 のタグ「会員」を選んで保存する
    const setup = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '設定する')
    expect(setup).toBeTruthy()
    await act(async () => {
      fireEvent.click(setup!)
    })
    await settle(50)
    await act(async () => {
      fireEvent.focus(combobox())
    })
    await settle(50)
    // 候補の一覧は MenuPortal で document.body 直下に出る（host の中にはない）。
    const option = Array.from(document.querySelectorAll('[role="option"]')).find((el) => el.textContent?.includes('会員'))
    expect(option).toBeTruthy()
    await act(async () => {
      fireEvent.click(option!)
    })
    await settle(50)
    const save = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'この面の設定を保存する')
    expect(save).toBeTruthy()
    await act(async () => {
      fireEvent.click(save!)
    })
    await settle(50)
    // acc-2（タグ「予約」だけ）へ切り替える
    accountState.id = 'acc-2'
    await act(async () => {
      root.render(<NewRichMenuPage />)
    })
    await settle(150)
    const tagUrls = fetchUrls.filter((url) => new URL(url, 'http://localhost').pathname === '/api/tags')
    expect(tagUrls.some((url) => url.includes('lineAccountId=acc-2'))).toBe(true)
    expect(host.textContent).toContain('1件は、今のアカウントにないため外しました')
  })
})
