// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://localhost/ec-commerce?tab=connector" }
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * #948(EC連携タブ「つなぎ先」)の回帰試験。実物の React で ConnectorPanel を
 * mount し、画面に出る文言と操作の結果を確かめる。
 *
 * - N-320: 「つながる先」はECをきっかけにする設定とアカウント全体の記録数を
 *   行ごとに区別し、やり直しかたを常時表示する
 * - N-322: 「取り込みを止める」は保存するまで止まらない。未保存の間は警告を
 *   出し、画面内リンクで離れようとしたら確認を挟む
 * - N-326: 保存ボタンが押せないとき、理由をそばに出す
 */

// importOriginal で実物の api.ts を評価するため、API URL を先に立てる。
const routerPush = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
  return vi.fn()
})
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(),
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      ecCommerce: {
        ...actual.api.ecCommerce,
        connector: vi.fn(),
        updateConnector: vi.fn(),
      },
    },
  }
})

import { api } from '@/lib/api'
import ToastHost, { clearToastsForTest } from '@/components/shared/toast'
import ConnectorPanel from '@/v8/settings/ec-commerce/connector'

const mockConnector = api.ecCommerce.connector as unknown as ReturnType<typeof vi.fn>
const mockUpdate = api.ecCommerce.updateConnector as unknown as ReturnType<typeof vi.fn>

const EVENT_TYPES = [
  'ec.order.confirmed',
  'ec.order.payment_received',
  'ec.order.shipped',
  'ec.order.cancelled',
  'ec.order.refunded',
  'ec.customer.profile_updated',
]
const RULES = ['verified_email', 'verified_phone', 'manual_name_postal']

function overview(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    connector: {
      id: 'connector-a', provider: 'shopify', shopDomain: 'nen-store.myshopify.com', status: 'connected',
      secretConfigured: true, secretLastFour: '8f3a', secretUpdatedAt: '2026-09-06T10:00:00+09:00',
      eventTypes: [...EVENT_TYPES], identityRules: [...RULES], version: 3, updatedAt: '2026-09-06T10:00:00+09:00',
      ...(overrides.connector as Record<string, unknown> | undefined),
    },
    health: { today: 1, last30Days: 20, failed: 0, lastReceivedAt: '2026-09-06T10:00:00+09:00', lastSucceededAt: '2026-09-06T10:00:00+09:00' },
    impact: { nenCampaigns: 2, conversions: 3, mileageRules: 1, friendFields: 4, analytics: 0 },
    retryPolicy: null,
  }
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  document.documentElement.dataset.theme = 'v8'
  clearToastsForTest()
  mockConnector.mockReset()
  mockUpdate.mockReset()
  routerPush.mockReset()
  mockConnector.mockResolvedValue({ success: true, data: overview() })
  mockUpdate.mockResolvedValue({ success: true, data: { version: 4 } })
})

afterEach(async () => {
  cleanup()
  delete document.documentElement.dataset.theme
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

async function mountReady(overrides: Record<string, unknown> = {}) {
  mockConnector.mockResolvedValue({ success: true, data: overview(overrides) })
  render(<><ToastHost /><ConnectorPanel accountId="account-a" /></>)
  await screen.findByLabelText('ショップのアドレス')
}

describe('#948 N-320: 影響件数の明示とやり直し規定の常時表示', () => {
  it('止まる設定とアカウント全体の記録数を行ごとに区別し、やり直しかたを常に出す', async () => {
    await mountReady()
    const links = screen.getByText(/つながる先：/)
    expect(links.getAttribute('title')).toContain('タグ 4 件（ECの出来事がきっかけ）')
    expect(links.getAttribute('title')).toContain('分析 0 件（アカウント全体）')
    expect(document.querySelector('a[href="/nen-campaigns"]')?.getAttribute('title')).toContain('ECの出来事がきっかけ 2 件')
    expect(document.querySelector('a[href="/conversions"]')?.getAttribute('title')).toContain('アカウント全体 3 件')
    expect(links.getAttribute('title')).toContain('失敗した処理のやり直しは「取り込みの記録」タブで一件ずつ「もう一度やる」から行います。')
    expect(links.getAttribute('title')).toContain('コンバージョンと分析はアカウント全体の記録数です。')
  })
})

describe('#948 N-322: 取り込みを止めるは保存必須であることを伝える', () => {
  it('押した直後に未保存であることを警告し、保存するまでAPIを呼ばない', async () => {
    await mountReady()
    fireEvent.click(screen.getByRole('button', { name: '取り込みを止める' }))
    expect(await screen.findByText(/まだ止まっていません。「設定を保存する」を押すと止まります/)).toBeTruthy()
    expect(mockUpdate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '設定を保存する' }))
    await screen.findByText('つなぎ先の設定を保存しました。')
    expect(mockUpdate).toHaveBeenCalledWith('account-a', expect.objectContaining({ status: 'paused' }))
  })

  it('止める変更を保存せずに画面内リンクで離れようとすると確認を挟む', async () => {
    await mountReady()
    fireEvent.click(screen.getByRole('button', { name: '取り込みを止める' }))
    await screen.findByText(/まだ止まっていません/)

    const link = document.createElement('a')
    link.href = '/ec-commerce'
    link.textContent = '取り込みの記録'
    document.body.appendChild(link)
    await act(async () => { link.click() })

    expect(await screen.findByText('保存していない変更があります')).toBeTruthy()
    expect(screen.getByText(/このまま移ると、取り込みは止まりません/)).toBeTruthy()
    expect(routerPush).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '設定に戻る' }))
    await waitFor(() => expect(screen.queryByText('保存していない変更があります')).toBeNull())

    await act(async () => { link.click() })
    fireEvent.click(await screen.findByRole('button', { name: '保存せずに移る' }))
    expect(routerPush).toHaveBeenCalledWith('/ec-commerce')
  })
})

describe('#948 N-326: 保存を送れない理由を表示する', () => {
  it('ショップのアドレスが空のとき、欄の理由を出し、保存を送らない', async () => {
    await mountReady()
    const domain = document.querySelector('input[placeholder="nen-store.myshopify.com"]') as HTMLInputElement
    fireEvent.change(domain, { target: { value: '' } })
    const save = screen.getByRole('button', { name: '設定を保存する' }) as HTMLButtonElement
    fireEvent.click(save)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(await screen.findByText(/ショップのドメインを入れてください/)).toBeTruthy()
    expect(document.activeElement).toBe(domain)

    fireEvent.change(domain, { target: { value: 'shop.example.com' } })
    expect((screen.getByRole('button', { name: '設定を保存する' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '設定を保存する' }))
    await screen.findByText('つなぎ先の設定を保存しました。')
    expect(mockUpdate).toHaveBeenCalledWith('account-a', expect.objectContaining({ shopDomain: 'shop.example.com' }))
  })

  it('鍵が未設定のつなぎ先では、32文字未満の理由を出す', async () => {
    await mountReady({ connector: { secretConfigured: false, secretLastFour: null, secretUpdatedAt: null } })
    fireEvent.change(screen.getByLabelText('つなぐための鍵'), { target: { value: 'short' } })
    const save = screen.getByRole('button', { name: '設定を保存する' }) as HTMLButtonElement
    fireEvent.click(save)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(await screen.findByText('32文字以上の鍵を入れてください。')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('つなぐための鍵'))
  })
})
