// @vitest-environment happy-dom
/*
 * 共通情報キーの接続(#862)を本物のReactで動かす試験。
 *
 * 見るのは3つだけ: 直URLゲートが共通情報画面を閉じること、差し込み口の
 * 「共通情報」ボタンが common_vars に連動すること、「友だち情報」ボタンが
 * friend_fields に連動すること（別キーを切っても残ること）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  features: { friend_fields: true, common_vars: true, media: true } as Record<string, boolean> | undefined,
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      featureSettings: {
        ...actual.api.featureSettings,
        visibility: vi.fn(async () =>
          state.features === undefined
            ? { success: false as const, error: 'unavailable' }
            : { success: true as const, data: { features: state.features } },
        ),
      },
      friendFields: {
        ...actual.api.friendFields,
        list: vi.fn(async () => ({ success: true as const, data: [] })),
      },
      commonVars: {
        ...actual.api.commonVars,
        list: vi.fn(async () => ({ success: true as const, data: [] })),
      },
    },
  }
})

vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', selectedAccount: null }),
}))

import FeatureGate from '../feature-gate'
import InsertToolbar from './insert-toolbar'
import { clearFeatureVisibilityCache } from '@/lib/feature-visibility-cache'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node)
  })
  // visibility 応答まで待つ
  await act(async () => {})
  await act(async () => {})
}

function Toolbar() {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = React.useState('')
  return React.createElement(InsertToolbar, { targetRef: ref, value, onChange: setValue })
}

describe('共通情報キーの画面接続(#862)', () => {
  beforeEach(() => {
    // 表示可否は画面間で共有される（V6R-S0-b）。試験ごとに応答を替えるので毎回捨てる。
    clearFeatureVisibilityCache()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    state.features = { friend_fields: true, common_vars: true, media: true }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('common_varsがonなら直URLは中身を出す', async () => {
    await render(React.createElement(FeatureGate, { feature: 'common_vars' },
      React.createElement('div', null, '共通情報の一覧')))
    expect(host.textContent).toContain('共通情報の一覧')
  })

  it('common_varsがoffなら直URLは無効画面に差し替わる', async () => {
    state.features = { friend_fields: true, common_vars: false, media: true }
    await render(React.createElement(FeatureGate, { feature: 'common_vars' },
      React.createElement('div', null, '共通情報の一覧')))
    expect(host.textContent).not.toContain('共通情報の一覧')
    expect(host.textContent).toContain('この機能は設定でオフになっています')
    expect(host.querySelector('[data-feature-disabled]')?.getAttribute('data-feature-disabled')).toBe('common_vars')
  })

  it('common_varsを切ると差し込みの「共通情報」だけが消え、「友だち情報」は残る', async () => {
    state.features = { friend_fields: true, common_vars: false, media: true }
    await render(React.createElement(Toolbar))
    const labels = Array.from(host.querySelectorAll('button')).map((el) => el.textContent?.trim())
    expect(labels).not.toContain('共通情報')
    expect(labels).toContain('友だち情報')
    expect(labels).toContain('名前')
  })

  it('friend_fieldsを切ると差し込みの「友だち情報」だけが消え、「共通情報」は残る', async () => {
    state.features = { friend_fields: false, common_vars: true, media: true }
    await render(React.createElement(Toolbar))
    const labels = Array.from(host.querySelectorAll('button')).map((el) => el.textContent?.trim())
    expect(labels).not.toContain('友だち情報')
    expect(labels).toContain('共通情報')
  })

  it('visibilityを読めなければfail-closedで両方とも出さない', async () => {
    state.features = undefined
    await render(React.createElement(Toolbar))
    const labels = Array.from(host.querySelectorAll('button')).map((el) => el.textContent?.trim())
    expect(labels).not.toContain('共通情報')
    expect(labels).not.toContain('友だち情報')
    // 機能に紐付かない差し込みは残る。
    expect(labels).toContain('名前')
  })
})
