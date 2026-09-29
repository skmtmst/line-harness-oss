// @vitest-environment happy-dom
/*
 * m18r: リッチメニュー作成のテンプレート候補は、いま選んでいるアカウントのものだけ。
 * 本物のReactで動かして見る。
 * - テンプレート一覧の取得に選択accountが付く（別アカウントのものが混ざらない）
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

const TEMPLATES_BY_ACCOUNT: Record<string, Array<{ id: string; name: string }>> = {
  'acc-1': [{ id: 'tpl-a1', name: 'お知らせ' }],
  'acc-2': [{ id: 'tpl-b2', name: '予約確認' }],
}

function stubFetch() {
  fetchUrls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const text = String(url)
    fetchUrls.push(text)
    const parsed = new URL(text, 'http://localhost')
    if (parsed.pathname === '/api/templates') {
      const accountId = parsed.searchParams.get('account_id')
      return { ok: true, status: 200, json: async () => ({ success: true, data: accountId ? (TEMPLATES_BY_ACCOUNT[accountId] ?? []) : [] }) }
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
  }))
}

async function settle(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

function templateUrls() {
  return fetchUrls.filter((url) => new URL(url, 'http://localhost').pathname === '/api/templates')
}

function clickOption(label: string) {
  const option = Array.from(document.querySelectorAll('[role="option"]')).find((el) =>
    el.textContent?.includes(label),
  )
  if (!option) throw new Error(`選択肢「${label}」が見つかりません`)
  const button = option.querySelector('button') ?? option
  fireEvent.click(button as Element)
}

describe('m18r 作成画面のテンプレート候補は選択accountで絞る', () => {
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

  it('テンプレート一覧の取得に選択accountが付く', async () => {
    await act(async () => {
      root.render(<NewRichMenuPage />)
    })
    await settle(100)
    expect(templateUrls().length).toBeGreaterThan(0)
    for (const url of templateUrls()) {
      expect(url).toContain('account_id=acc-1')
    }
  })

  it('切り替えたら前の候補にしかない選択を外して知らせる', async () => {
    await act(async () => {
      root.render(<NewRichMenuPage />)
    })
    await settle(100)
    // 1面目の動きを開き、動きを「テンプレートを送る」に変える
    const setup = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === '設定する')
    expect(setup).toBeTruthy()
    await act(async () => {
      fireEvent.click(setup!)
    })
    await settle(50)
    const intentTrigger = host.querySelector('button[aria-label="押したときの動き"]')
    expect(intentTrigger).toBeTruthy()
    await act(async () => {
      fireEvent.click(intentTrigger!)
    })
    await settle(50)
    await act(async () => {
      clickOption('テンプレートを送る')
    })
    await settle(50)
    // acc-1 のテンプレート「お知らせ」を選ぶ
    const templateTrigger = host.querySelector('button[aria-label="送るテンプレート"]')
    expect(templateTrigger).toBeTruthy()
    await act(async () => {
      fireEvent.click(templateTrigger!)
    })
    await settle(50)
    await act(async () => {
      clickOption('お知らせ')
    })
    await settle(50)
    const save = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'この面の設定を保存')
    expect(save).toBeTruthy()
    await act(async () => {
      fireEvent.click(save!)
    })
    await settle(50)
    // acc-2（テンプレート「予約確認」だけ）へ切り替える
    accountState.id = 'acc-2'
    await act(async () => {
      root.render(<NewRichMenuPage />)
    })
    await settle(150)
    expect(templateUrls().some((url) => url.includes('account_id=acc-2'))).toBe(true)
    expect(host.textContent).toContain('1件は、今のアカウントにないため外しました')
  })
})
