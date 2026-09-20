// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import NewConversionPage from './page'

/*
 * DETAIL-16/17 の回帰検査(#1004)。監査の再現検査を、期待を正常動作へ
 * 変えて残したもの。
 *
 * - DETAIL-16: 「使う場所」の候補APIが失敗しても空の成功と同じ
 *   「まだありません」にしない。種類ごとに 空200 / 403 / 500相当 /
 *   一部だけ失敗 を区別し、失敗した種類だけに再試行を出す。
 * - DETAIL-17: 集計対象アカウントは画面上部の選択に固定する
 *   （案件作成 #686 と同じ決めごと）。詳細設定には編集可能な選択欄を
 *   置かず、固定対象を明示する。「すべて」は保存側がアカウント必須の
 *   ため選択肢にしない。
 */
const st = vi.hoisted(() => ({
  accountId: 'account-a' as string | null,
  accounts: [
    { id: 'account-a', name: 'A店' },
    { id: 'account-b', name: 'B店' },
  ],
  /** true のとき各種類は候補を1件返す。false なら空200。 */
  withData: false,
  /** 種類ごとの取得結果: ok=成功 / error=500相当 / forbidden=403。 */
  usage: { analytics: 'ok', nen_campaign: 'ok', automation: 'ok' } as Record<
    string,
    'ok' | 'error' | 'forbidden'
  >,
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({
    selectedAccountId: st.accountId,
    selectedAccount: st.accounts.find((a) => a.id === st.accountId) ?? null,
    accounts: st.accounts,
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
  const respond = (kind: string, data: unknown[]) => {
    if (st.usage[kind] === 'forbidden') throw new ApiError(403, 'audit forbidden')
    if (st.usage[kind] === 'error') throw new ApiError(500, 'audit network')
    return { success: true, data: st.withData ? data : [] }
  }
  return {
    ApiError,
    api: {
      conversions: {
        points: async () => ({ success: true, data: [] }),
        previewDefinition: async () => ({ success: false, error: 'audit preview not available' }),
      },
      analytics: {
        v6Funnels: {
          list: async () =>
            respond('analytics', [{ id: 'funnel-1', name: '購入までのファネル', currentVersion: { id: 'fv-1' } }]),
        },
      },
      automations: {
        list: async () => respond('automation', [{ id: 'auto-1', name: '購入後の挨拶', versionId: 'av-1' }]),
      },
      nenCampaigns: {
        settings: async () => respond('nen_campaign', [{ campaignKey: 'nen-1', label: '定期便の案内' }]),
      },
    },
  }
})

let root: Root, host: HTMLDivElement
beforeEach(() => {
  st.accountId = 'account-a'
  st.withData = false
  st.usage = { analytics: 'ok', nen_campaign: 'ok', automation: 'ok' }
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
}

describe('DETAIL-16 「使う場所」の候補は失敗と空の成功を区別する', () => {
  it('全部の候補APIが失敗しても「まだありません」にはしない。読み込めません＋再読み込みを出す', async () => {
    st.usage = { analytics: 'error', nen_campaign: 'error', automation: 'error' }
    await render()
    expect(host.textContent).toContain('読み込めませんでした')
    expect(host.textContent).toContain('再読み込み')
    expect(host.textContent).not.toContain('がまだありません')
  })

  it('403は権限不足として区別し、変わらない再読み込みは出さない', async () => {
    st.usage = { analytics: 'forbidden', nen_campaign: 'forbidden', automation: 'forbidden' }
    await render()
    expect(host.textContent).toContain('権限がありません')
    expect(host.textContent).not.toContain('がまだありません')
    expect(host.textContent).not.toContain('再読み込み')
  })

  it('空200は「まだありません」のまま（失敗と混ぜない）', async () => {
    await render()
    expect(host.textContent).toContain('使える分析がまだありません')
    expect(host.textContent).toContain('使えるNEN配信がまだありません')
    expect(host.textContent).toContain('使える自動化がまだありません')
  })

  it('一種類だけ失敗：その種類だけ失敗表示、読めた種類の候補は使えるまま', async () => {
    st.withData = true
    st.usage = { analytics: 'ok', nen_campaign: 'ok', automation: 'error' }
    await render()
    expect(host.textContent).toContain('購入までのファネル')
    expect(host.textContent).toContain('定期便の案内')
    expect(host.textContent).toContain('使える自動化を読み込めませんでした')
    expect(host.textContent).not.toContain('使える分析を読み込めませんでした')
    expect(host.textContent).not.toContain('使えるNEN配信を読み込めませんでした')
  })

  it('失敗した種類の再読み込みで候補が戻る', async () => {
    st.withData = true
    st.usage = { analytics: 'ok', nen_campaign: 'ok', automation: 'error' }
    await render()
    st.usage = { ...st.usage, automation: 'ok' }
    const retry = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === '自動化を再読み込み',
    )
    expect(retry).toBeTruthy()
    await act(async () => {
      fireEvent.click(retry!)
    })
    expect(host.textContent).toContain('購入後の挨拶')
    expect(host.textContent).not.toContain('使える自動化を読み込めませんでした')
  })
})

describe('DETAIL-17 集計対象は画面上部のアカウントに固定', () => {
  it('詳細設定の対象欄は選び直せる選択欄ではなく、固定対象の明示', async () => {
    await render()
    const el = host.querySelector('#cv-account')
    expect(el?.tagName).not.toBe('SELECT')
    expect(el?.textContent).toBe('A店')
    expect(host.textContent).toContain('画面上部で選んでいるLINEアカウントに固定されます')
    // 「すべて」は保存側がアカウント必須のため、選べる選択肢にはしない。
    expect(host.querySelector('select#cv-account')).toBeNull()
  })

  it('ヘッダーのアカウントが変わると固定表示も追従する', async () => {
    await render()
    st.accountId = 'account-b'
    await act(async () => root.render(<NewConversionPage />))
    expect(host.querySelector('#cv-account')?.textContent).toBe('B店')
  })
})
