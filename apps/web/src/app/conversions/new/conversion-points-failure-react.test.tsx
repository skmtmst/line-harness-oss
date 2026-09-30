// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import NewConversionPage from './page'

/*
 * R597: 新規画面の同名判定のもと（`GET /api/conversions/points`）が503でも、
 * 黙って空として扱わない。失敗を明示して再試行を付け、同名確認が
 * 未完了であることを伝える。通信回復後は同名警告が戻る。
 */
const st = vi.hoisted(() => ({
  accountId: 'account-a' as string | null,
  pointsMode: 'ok' as 'ok' | 'error',
  points: [] as Array<{ name: string; lineAccountId: string | null }>,
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: st.accountId,
    selectedAccount: st.accountId ? { id: st.accountId, name: 'A店' } : null,
    accounts: [{ id: 'account-a', name: 'A店' }],
  }),
}))
vi.mock('@/components/layout/header', () => ({ default: () => null }))
vi.mock('@/components/shared/sticky-bar', () => ({
  default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
}))
vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    status: number
    constructor(status: number, message?: string) {
      super(message ?? `API error: ${status}`)
      this.status = status
    }
  }
  return {
    ApiError,
    api: {
      conversions: {
        points: async () => {
          if (st.pointsMode === 'error') throw new ApiError(503, 'audit points 503')
          return { success: true, data: st.points }
        },
        previewDefinition: async () => ({ success: false, error: 'audit preview not available' }),
      },
      analytics: {
        v6Funnels: { list: async () => ({ success: true, data: [] }) },
      },
      automations: {
        list: async () => ({ success: true, data: [] }),
      },
      nenCampaigns: {
        settings: async () => ({ success: true, data: [] }),
      },
      featureSettings: {
        visibility: async () => ({ success: true, data: { features: {} } }),
      },
      tags: { list: async () => ({ success: true, data: [] }) },
      friendFields: { list: async () => ({ success: true, data: [] }) },
      supportMarks: { list: async () => ({ success: true, data: [] }) },
      scenarios: { list: async () => ({ success: true, data: [] }) },
    },
  }
})

// happy-dom 環境では import.meta.url が file ではないため、cwd 基準で読む。
const NEW_PAGE = readFileSync('src/app/conversions/new/page.tsx', 'utf8')

let root: Root, host: HTMLDivElement
beforeEach(() => {
  st.accountId = 'account-a'
  st.pointsMode = 'ok'
  st.points = []
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
async function render() {
  await act(async () => root.render(<NewConversionPage />))
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}
async function typeName(value: string) {
  const input = host.querySelector('#cv-name') as HTMLInputElement | null
  expect(input, '名前欄が見つかりません').not.toBeNull()
  await act(async () => {
    fireEvent.change(input!, { target: { value } })
  })
}
async function clickRetry() {
  const retry = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === '同名の確認を再読み込み',
  )
  expect(retry, '再試行が見つかりません').toBeTruthy()
  await act(async () => {
    fireEvent.click(retry!)
  })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

describe('R597 同名確認の取得失敗は明示して再試行を付ける', () => {
  it('同名判定のもとを握りつぶさず、失敗と再試行を出す', () => {
    // 失敗を無かったことにしない（以前の `.catch(() => undefined)` へ戻さない）。
    expect(NEW_PAGE).toContain('setPointsFailed(true)')
    expect(NEW_PAGE).toContain('同名の確認を再読み込み')
  })

  it('503でも同名警告は出さず、未確認と再試行を出す', async () => {
    st.pointsMode = 'error'
    await render()
    expect(host.textContent).toContain('同じ名前があるか確認できませんでした')
    expect(host.textContent).toContain('同名の確認を再読み込み')
    await typeName('商品を買った')
    // もとが読めていないのに「重複なし」とは言わない。
    expect(host.textContent).toContain('同じ名前があるか確認できませんでした')
  })

  it('再試行で直れば同名警告が戻り、失敗表示は消える', async () => {
    st.pointsMode = 'error'
    await render()
    await typeName('商品を買った')
    expect(host.textContent).not.toContain('同じ名前の「商品を買った」があります')
    st.pointsMode = 'ok'
    st.points = [{ name: '商品を買った', lineAccountId: 'account-a' }]
    await clickRetry()
    expect(host.textContent).toContain('同じ名前の「商品を買った」があります')
    expect(host.textContent).not.toContain('同じ名前があるか確認できませんでした')
  })

  it('正常時は同名警告だけで失敗表示は出ない', async () => {
    st.points = [{ name: '商品を買った', lineAccountId: 'account-a' }]
    await render()
    await typeName('商品を買った')
    expect(host.textContent).toContain('同じ名前の「商品を買った」があります')
    expect(host.textContent).not.toContain('同じ名前があるか確認できませんでした')
  })
})
