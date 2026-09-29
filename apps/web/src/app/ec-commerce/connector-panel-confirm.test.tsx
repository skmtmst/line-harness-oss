// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * #517 軽7: 出来事・照合ルールを全部外しても保存は止めない(止めたい場面が
 * ある)。代わりに確認ダイアログを1枚挟み、押した人が自覚できる形にする。
 * ここは本物のReactで `ConnectorPanel` をmountし、チェック操作と保存押下で
 * 挙動(ダイアログの有無・保存の有無・送る中身)を見張る。
 *
 * - G1: 全部入りで保存 → ダイアログ無しでそのまま保存する
 * - G2: 出来事を全部外して保存 → ダイアログが出て、まだ保存しない
 * - G3: ダイアログで「止めて保存する」→ 空のまま保存する(止めない)
 * - G4: ダイアログでキャンセル → 保存しない
 * - G5: 照合ルールを全部外して保存 → 照合側の文面でダイアログが出る
 */

// importOriginal で実物の api.ts を評価するため、API URL を先に立てる。
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

// #948 N-322: パネルが未保存ガード(useUnsavedGuard→useRouter)を持つため、
// App Router の文脈が無い試験環境では useRouter を差し替える。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
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
import ConnectorPanel from './connector-panel'

const mockConnector = api.ecCommerce.connector as unknown as ReturnType<typeof vi.fn>
const mockUpdate = api.ecCommerce.updateConnector as unknown as ReturnType<typeof vi.fn>

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const EVENT_TYPES = [
  'ec.order.confirmed',
  'ec.order.payment_received',
  'ec.order.shipped',
  'ec.order.cancelled',
  'ec.order.refunded',
  'ec.customer.profile_updated',
]
const RULES = ['verified_email', 'verified_phone', 'manual_name_postal']

function overview() {
  return {
    configured: true,
    connector: {
      id: 'connector-a', provider: 'shopify', shopDomain: 'nen-store.myshopify.com', status: 'connected',
      secretConfigured: true, secretLastFour: '8f3a', secretUpdatedAt: '2026-09-06T10:00:00+09:00',
      eventTypes: [...EVENT_TYPES], identityRules: [...RULES], version: 3, updatedAt: '2026-09-06T10:00:00+09:00',
    },
    health: { today: 1, last30Days: 20, failed: 0, lastReceivedAt: '2026-09-06T10:00:00+09:00', lastSucceededAt: '2026-09-06T10:00:00+09:00' },
    impact: { nenCampaigns: 2, conversions: 3, mileageRules: 1, friendFields: 4, analytics: 0 },
    retryPolicy: null,
  }
}

function ok<T>(data: T) {
  return { success: true, data }
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  mockConnector.mockReset()
  mockUpdate.mockReset()
  mockConnector.mockResolvedValue(ok(overview()))
  mockUpdate.mockResolvedValue(ok({ version: 4 }))
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  if (container) container.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

async function mountReady(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(<ConnectorPanel accountId="account-a" />) })
  await act(async () => { await drainMicrotasks() })
  if (!container.textContent?.includes('設定を保存')) throw new Error('保存画面が出ませんでした')
  return container
}

function checkboxes(el: HTMLDivElement): HTMLInputElement[] {
  return Array.from(el.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]
}

function saveButton(el: HTMLDivElement): HTMLButtonElement {
  const button = Array.from(el.querySelectorAll('button')).find((node) => node.textContent === '設定を保存')
  if (!button) throw new Error('「設定を保存」ボタンが見つかりません')
  return button as HTMLButtonElement
}

function dialogButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes(label))
  if (!button) throw new Error(`ダイアログの「${label}」が見つかりません`)
  return button as HTMLButtonElement
}

describe('つなぎ先の全外し確認(#517 軽7)', () => {
  it('G1: 全部入りで保存すると、確認を挟まずそのまま保存する', async () => {
    const el = await mountReady()
    await act(async () => { saveButton(el).click() })
    await act(async () => { await drainMicrotasks() })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('すべて止めますか？')
    expect(el.textContent).toContain('つなぎ先の設定を保存しました。')
  })

  it('G2: 出来事を全部外して保存すると、確認が出てまだ保存しない', async () => {
    const el = await mountReady()
    const boxes = checkboxes(el)
    expect(boxes).toHaveLength(9)
    await act(async () => {
      for (const box of boxes.slice(0, 6)) box.click()
    })
    await act(async () => { saveButton(el).click() })
    expect(document.body.textContent).toContain('すべての出来事の取り込みを止めますか？')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('G3: 確認で「止めて保存する」を押すと、空のまま保存する', async () => {
    const el = await mountReady()
    await act(async () => {
      for (const box of checkboxes(el).slice(0, 6)) box.click()
    })
    await act(async () => { saveButton(el).click() })
    await act(async () => { dialogButton('止めて保存する').click() })
    await act(async () => { await drainMicrotasks() })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({ eventTypes: [] })
    expect(el.textContent).toContain('つなぎ先の設定を保存しました。')
  })

  it('G4: 確認でキャンセルすると、保存しない', async () => {
    const el = await mountReady()
    await act(async () => {
      for (const box of checkboxes(el).slice(0, 6)) box.click()
    })
    await act(async () => { saveButton(el).click() })
    await act(async () => { dialogButton('キャンセル').click() })
    await act(async () => { await drainMicrotasks() })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('すべての出来事の取り込みを止めますか？')
  })

  it('G5: 照合ルールを全部外して保存すると、照合側の文面で確認が出る', async () => {
    const el = await mountReady()
    await act(async () => {
      for (const box of checkboxes(el).slice(6, 9)) box.click()
    })
    await act(async () => { saveButton(el).click() })
    expect(document.body.textContent).toContain('自動の照合をすべて止めますか？')
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
